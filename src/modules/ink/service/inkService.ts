/**
 * Ink service: loads, autosaves and publishes a note's ink layer
 * (decision Q9, module doc "Saving and sync").
 *
 * Two copies per note:
 *  - WORKING copy  ink/work/<noteId>.json   local only, never synced.
 *    Written 1.5 s after the last change, on leaving Draw mode and when the
 *    app goes to the background. Only exists while a visit has unpublished
 *    changes (or after a crash).
 *  - PUBLISHED copy ink/<assetId>.json  (= assets.localPath), synced by P2b.
 *    Rewritten ONLY on leaving the note (publish()), and only when its bytes
 *    actually changed. Then exactly one synced row update happens (asset
 *    size, or the first-time asset + notes.inkLayerRef), so P2b uploads at
 *    most once per visit (Storage free tier: 5K uploads/month), and the file
 *    never changes while P2b may be uploading it between visits.
 *
 * Crash safety: recover() (app start) publishes every leftover working copy;
 * a working copy is merged with the published one on open, so nothing drawn
 * before a crash is lost. Damaged files never replace good ones: the loader
 * rejects them and the session reports `damaged`.
 *
 * Privacy: handwriting is note content. Nothing here logs stroke data, only
 * event names and counts.
 */
import { AppError, ENTITY_ID_PATTERN, errorCode, type IdGenerator, type Logger } from '@/core';

import { emptyInkLayer, parseInkJson, serializeInk, type InkLayer } from '../model/format';
import { purgeUnrecoverable, type OpContext } from '../model/layer';
import { INK_LIMITS } from '../model/limits';
import { mergeInkLayers } from '../model/merge';
import type { InkFilesPort, InkStorePort } from './ports';

export const WORK_DIR = 'ink/work';
export const INK_DIR = 'ink';
export const WORKING_SAVE_DEBOUNCE_MS = 1_500;

export const publishedPath = (assetId: string) => `${INK_DIR}/${assetId}.json`;
export const workingPath = (noteId: string) => `${WORK_DIR}/${noteId}.json`;

export interface InkServiceDeps {
  files: InkFilesPort;
  store: InkStorePort;
  ids: IdGenerator;
  logger: Logger;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export type InkSource = 'empty' | 'published' | 'working' | 'merged';

export interface PublishResult {
  /** True when the published file and the synced row were written. */
  published: boolean;
  /** The note's new `updated` when it was linked to a new asset (mark it seen in the editor session). */
  noteUpdated?: number;
}

export interface InkSession {
  readonly noteId: string;
  readonly layer: InkLayer;
  readonly source: InkSource;
  /** A stored copy was damaged and ignored (the UI shows a banner). */
  readonly damaged: boolean;
  /** Unsaved changes since the last working-copy write. */
  readonly dirty: boolean;
  /** Sets the new layer after an edit and schedules the working-copy save. */
  replace(next: InkLayer): void;
  /** Writes the working copy now (leaving Draw mode, app to background). */
  flush(): Promise<void>;
  /**
   * Leaving the note: publish if changed (see file header). Pass the block
   * ids of the editor's LATEST document (it may be newer than the stored
   * one), so strokes on a block created seconds ago are never purged.
   * The screen flushes the note's autosave before calling this.
   */
  publish(opts?: { liveBlockIds?: Iterable<string> }): Promise<PublishResult>;
  dispose(): void;
}

const NOTE_FILE = /^([A-Za-z0-9_-]{16,64})\.json$/;

export function createInkService(deps: InkServiceDeps) {
  const now = deps.now ?? Date.now;
  const setT = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const log = deps.logger.child('ink');
  const opCtx: OpContext = { newStrokeId: () => deps.ids.newId('s'), now };

  const assertNoteId = (noteId: string) => {
    if (!ENTITY_ID_PATTERN.test(noteId)) throw new AppError('validation_failed', 'Unknown note.');
  };

  /** Reads and validates one file; returns null when missing, 'damaged' when invalid. */
  const load = async (path: string, noteId: string): Promise<InkLayer | null | 'damaged'> => {
    const text = await deps.files.read(path);
    if (text === null) return null;
    const r = parseInkJson(text, { expectedNote: noteId });
    if (!r.ok) {
      log.warn('load_rejected', { code: r.error.code });
      return 'damaged';
    }
    return r.value;
  };

  async function open(noteId: string): Promise<InkSession> {
    assertNoteId(noteId);
    const note = await deps.store.getNote(noteId);
    if (!note || note.deleted) throw new AppError('not_found', 'This note no longer exists.');

    // Published copy (through the note's asset), then any leftover working copy.
    let publishedText: string | null = null;
    let published: InkLayer | null = null;
    let damaged = false;
    const asset = note.inkLayerRef ? await deps.store.getAsset(note.inkLayerRef) : null;
    if (asset && !asset.deleted && asset.localPath) {
      publishedText = await deps.files.read(asset.localPath);
      if (publishedText !== null) {
        const r = parseInkJson(publishedText, { expectedNote: noteId });
        if (r.ok) published = r.value;
        else {
          damaged = true;
          publishedText = null; // never treat a damaged file as "unchanged"
          log.warn('published_rejected', { code: r.error.code });
        }
      }
    }
    const working = await load(workingPath(noteId), noteId);
    if (working === 'damaged') damaged = true;

    let layer: InkLayer;
    let source: InkSource;
    if (working && working !== 'damaged' && published) {
      const m = mergeInkLayers(published, working);
      layer = m.ok ? m.value : working;
      source = 'merged';
    } else if (working && working !== 'damaged') {
      layer = working;
      source = 'working';
    } else if (published) {
      layer = published;
      source = 'published';
    } else {
      layer = emptyInkLayer(noteId);
      source = 'empty';
    }
    log.info('opened', { source, strokes: layer.strokes.length });

    let current = layer;
    let dirty = false;
    let timer: unknown = null;
    let disposed = false;
    let writeChain: Promise<void> = Promise.resolve();

    const cancelTimer = () => {
      if (timer !== null) clearT(timer);
      timer = null;
    };

    /** Writes the working copy (serialized through a chain so writes never overlap). */
    const writeWorking = (): Promise<void> => {
      cancelTimer();
      if (!dirty) return writeChain;
      dirty = false;
      const text = serializeInk(current);
      writeChain = writeChain
        .then(() => deps.files.writeAtomic(workingPath(noteId), text))
        .catch((e: unknown) => {
          dirty = true; // try again with the next change or flush
          log.warn('working_save_failed', { code: errorCode(e) });
        });
      return writeChain;
    };

    const session: InkSession = {
      noteId,
      get layer() {
        return current;
      },
      source,
      damaged,
      get dirty() {
        return dirty;
      },
      replace(next) {
        if (disposed || next === current) return;
        if (next.note !== noteId) throw new AppError('validation_failed', 'This drawing belongs to another note.');
        current = next;
        dirty = true;
        cancelTimer();
        timer = setT(() => {
          timer = null;
          void writeWorking();
        }, WORKING_SAVE_DEBOUNCE_MS);
      },
      flush: () => writeWorking(),
      async publish(opts = {}) {
        await writeWorking();
        // Drop strokes whose block can't come back from the doc, the editor or any saved version (decision Q4).
        const keep = await deps.store.recoverableBlockIds(noteId);
        for (const id of opts.liveBlockIds ?? []) keep.add(id);
        current = purgeUnrecoverable(current, keep, opCtx);
        const text = serializeInk(current);
        if (text.length > INK_LIMITS.maxFileBytes) {
          // applyOp keeps layers under the cap, so this means a bug: keep the working copy, don't publish.
          log.error('publish_too_large', { bytes: text.length });
          return { published: false };
        }

        const n = await deps.store.getNote(noteId);
        if (!n || n.deleted) {
          await deps.files.remove(workingPath(noteId));
          return { published: false };
        }
        const a = n.inkLayerRef ? await deps.store.getAsset(n.inkLayerRef) : null;
        const live = a && !a.deleted ? a : null;

        let result: PublishResult = { published: false };
        if (live && text === publishedText) {
          // Unchanged since it was published: nothing to sync.
        } else if (!live && current.strokes.length === 0 && current.gone.length === 0) {
          // Never drew anything: no asset for an empty layer.
        } else if (live) {
          const path = live.localPath ?? publishedPath(live.id);
          await deps.files.writeAtomic(path, text);
          await deps.store.setAssetSize(live.id, text.length); // ASCII-only: chars == bytes (§6.3)
          result = { published: true };
        } else {
          const id = deps.ids.newId('a');
          const path = publishedPath(id);
          await deps.files.writeAtomic(path, text);
          try {
            const r = await deps.store.createInkLayer(noteId, { id, localPath: path, size: text.length });
            result = { published: true, noteUpdated: r.noteUpdated };
          } catch (e) {
            await deps.files.remove(path); // no row points at it: don't leave an untracked file
            throw e;
          }
        }
        publishedText = text;
        await deps.files.remove(workingPath(noteId));
        if (result.published) log.info('published', { strokes: current.strokes.length, bytes: text.length });
        return result;
      },
      dispose() {
        disposed = true;
        cancelTimer();
      },
    };
    return session;
  }

  /**
   * App start: publish every leftover working copy (a crash or kill before
   * leaving the note). Copies for missing or deleted notes are removed.
   */
  async function recover(): Promise<{ published: number; removed: number }> {
    let published = 0;
    let removed = 0;
    for (const name of await deps.files.list(WORK_DIR)) {
      const m = NOTE_FILE.exec(name);
      const noteId = m?.[1];
      try {
        const note = noteId ? await deps.store.getNote(noteId) : null;
        if (!noteId || !note || note.deleted) {
          await deps.files.remove(`${WORK_DIR}/${name}`);
          removed++;
          continue;
        }
        const s = await open(noteId);
        const r = await s.publish();
        s.dispose();
        if (r.published) published++;
      } catch (e) {
        log.warn('recover_failed', { code: errorCode(e) });
      }
    }
    if (published || removed) log.info('recovered', { published, removed });
    return { published, removed };
  }

  /** Tombstones ink assets of notes that are gone, and deletes their local files. */
  async function sweepOrphans(): Promise<number> {
    const orphans = await deps.store.inkOrphans();
    for (const a of orphans) {
      try {
        if (a.localPath) await deps.files.remove(a.localPath);
        await deps.store.removeAsset(a.id);
      } catch (e) {
        log.warn('sweep_failed', { code: errorCode(e) });
      }
    }
    if (orphans.length) log.info('swept', { count: orphans.length });
    return orphans.length;
  }

  /**
   * Read-only access for export (P6): the note's current layer (working copy
   * merged in), validated. Null when the note has no ink.
   */
  async function read(noteId: string): Promise<InkLayer | null> {
    const s = await open(noteId);
    s.dispose();
    return s.layer.strokes.length ? s.layer : null;
  }

  return { open, recover, sweepOrphans, read };
}

export type InkService = ReturnType<typeof createInkService>;

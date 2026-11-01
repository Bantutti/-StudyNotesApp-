/**
 * fixtures.ts — one VALID document per collection (read model), plus the
 * converter that turns it into a write payload the rules will accept.
 *
 * Read model vs write payload (docs/backend/DATA_MODEL.md §D.3):
 *   - read model: what zod validates after a read; timestamps are Timestamp objects.
 *   - write payload: what the app sends; fields whose meta role is 'server'
 *     (created, updated, deletionRequestedAt when set) become serverTimestamp().
 */
import { serverTimestamp, Timestamp } from 'firebase/firestore';
import type { z } from 'zod';
import { COLLECTION_SCHEMAS, userSchema, type CollectionName } from '../../src/schemas/collections.js';
import { fieldMetaOf } from '../../src/schemas/primitives.js';

export type AnyDoc = Record<string, unknown>;
export type FixtureCollection = CollectionName | 'users';

let counter = 0;
/** Deterministic-but-unique 20-char entity ids, e.g. "fx00000000000000001a". */
export function newId(tag = 'fx'): string {
  counter += 1;
  return `${tag}${String(counter).padStart(16, '0')}aa`.slice(0, 20);
}

export const VALID_DOCUMENT_JSON = JSON.stringify({
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { blockId: 'blk_h1', level: 1 },
      content: [{ type: 'text', text: 'Osmosis' }],
    },
    {
      type: 'definition',
      attrs: { blockId: 'blk_def1', audioAnchor: { recordingId: 'rec0000000000000001', startMs: 1000, endMs: 4500 } },
      content: [{ type: 'text', text: 'Movement of water across a membrane', marks: [{ type: 'highlight' }] }],
    },
  ],
});

export const VALID_SEGMENTS_JSON = JSON.stringify([
  { id: 's1', start: 0, end: 4200, text: 'Today we talk about osmosis.' },
  { id: 's2', start: 4200, end: 9000, text: 'Water moves across the membrane.' },
]);

export const VALID_DEFINITION_JSON = JSON.stringify({ id: 'my-pack', version: 3, paper: { type: 'lined' } });

/** Shared meta block for synced docs, as READ back (timestamps already resolved). */
function meta(uid: string, id: string): AnyDoc {
  const now = Timestamp.now();
  return { id, owner: uid, schemaVersion: 1, created: now, updated: now, rev: 1, deleted: false };
}

/** Builds a valid read-model doc for `collection`, owned by `uid`. */
export function validDoc(collection: FixtureCollection, uid: string, id: string = newId()): AnyDoc {
  switch (collection) {
    case 'users': {
      const now = Timestamp.now();
      return { id: uid, owner: uid, schemaVersion: 1, created: now, updated: now, rev: 1, settings: '{"theme":"light"}', deletionRequestedAt: null };
    }
    case 'subjects':
      return {
        ...meta(uid, id), name: 'Biology', color: 'a3d9a5', icon: 'flask', defaultPack: 'pastel-highlight',
        defaultTemplate: 'cornell', examDates: [Timestamp.fromMillis(Date.UTC(2026, 11, 10))], aiAllowed: true, autoMakeCards: false,
      };
    case 'folders':
      return { ...meta(uid, id), subject: newId('sb'), name: 'Unit 1', parent: null };
    case 'notes':
      return {
        ...meta(uid, id), subject: newId('sb'), folder: null, title: 'Osmosis lecture', document: VALID_DOCUMENT_JSON,
        inkLayerRef: null, stylePackId: 'pastel-highlight', templateId: 'lecture', tags: ['bio', 'exam'],
      };
    case 'cards':
      return {
        ...meta(uid, id), subject: newId('sb'), note: newId('nt'), sourceBlockId: 'blk_def1', type: 'basic',
        front: 'Osmosis', back: 'Movement of water across a membrane', source: 'definition', sourceChanged: false, suspended: false,
      };
    case 'reviewLogs':
      return {
        id, owner: uid, schemaVersion: 1, created: Timestamp.now(), card: newId('cd'), rating: 3,
        reviewedAt: Timestamp.fromMillis(Date.now() - 60_000), device: 'pixel7-a1',
      };
    case 'recordings':
      return {
        ...meta(uid, id), note: newId('nt'), asset: newId('as'), duration: 9000, language: 'en',
        segments: VALID_SEGMENTS_JSON, bookmarks: [4200],
      };
    case 'assets':
      return { ...meta(uid, id), type: 'audio', cloudPath: `users/${uid}/audio/${id}.m4a`, size: 1024 };
    case 'stylePacks':
      return { ...meta(uid, id), version: 3, definition: VALID_DEFINITION_JSON, createdFromReference: false };
    case 'templates':
      return { ...meta(uid, id), version: 1, definition: VALID_DEFINITION_JSON };
  }
}

/** zod schema for a fixture collection. */
export function schemaFor(collection: FixtureCollection): z.ZodObject {
  return collection === 'users' ? userSchema : COLLECTION_SCHEMAS[collection];
}

/**
 * Converts a read-model doc to a CREATE payload: server-role timestamp fields
 * become serverTimestamp() (only when they hold a timestamp; null stays null,
 * a mutated wrong-type value stays as-is so the rules see it).
 */
export function toCreatePayload(collection: FixtureCollection, d: AnyDoc): AnyDoc {
  const shape = schemaFor(collection).shape as Record<string, z.ZodType>;
  const out: AnyDoc = { ...d };
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const info = fieldMetaOf(fieldSchema);
    if (info?.meta.kind === 'timestamp' && info.meta.role === 'server' && out[key] instanceof Timestamp) {
      out[key] = serverTimestamp();
    }
  }
  return out;
}

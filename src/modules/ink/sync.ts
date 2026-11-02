/**
 * Sync hand-off for ink (P4b M8, decision Q10).
 *
 * P2b owns the generic Storage pipeline (asset doc first, then the file;
 * downloads on demand). Ink plugs in at two points, through small ports so
 * this module never imports P2b's internals:
 *
 *  1. MERGE. When an ink upload is rejected as stale, or a newer ink file is
 *     pulled while this device has unpublished changes, P2b calls the merger
 *     registered for type 'ink' with both file texts. inkAssetMerger parses
 *     BOTH as untrusted (size before parse, strict schema, same note), takes
 *     the union with tombstones (INK_MATH §10) and returns the merged file
 *     text, or null when either side is invalid or the union would pass the
 *     caps (P2b then keeps the local copy and reports it; nothing is lost).
 *
 *  2. DOWNLOAD ON OPEN. On a device that has the note but not its ink file
 *     yet (a fresh install signed in to the same account), InkService.open()
 *     asks the optional InkDownloadPort for the file text, validates it, and
 *     stores it as the published copy.
 *
 * Deletes need nothing new: a note's ink asset is tombstoned by the orphan
 * sweep (M2) and P2b deletes the cloud file.
 */
import { mergeInkLayers } from './model/merge';
import { parseInkJson, serializeInk } from './model/format';

/** P2b's registry (src/modules/sync/assets.ts, being added by P2b). Structural, so either side can merge first. */
export interface AssetMergerRegistry {
  registerAssetMerger(type: 'ink', merge: (localText: string, remoteText: string) => string | null): void;
}

/** Fetches an asset's cloud file text (P2b's download pipeline), or null when it isn't available. */
export type InkDownloadPort = (assetId: string) => Promise<string | null>;

/**
 * Merges two ink files of the SAME note. Returns the merged file text, or
 * null when a side is invalid (damaged or tampered), belongs to another note,
 * or the union is too large. Pure: never throws, never logs content.
 */
export function inkAssetMerger(localText: string, remoteText: string): string | null {
  const local = parseInkJson(localText);
  if (!local.ok) return null;
  const remote = parseInkJson(remoteText, { expectedNote: local.value.note });
  if (!remote.ok) return null;
  const merged = mergeInkLayers(local.value, remote.value);
  return merged.ok ? serializeInk(merged.value) : null;
}

/** Plugs the ink merger into P2b's pipeline (call once, from the composition root). */
export function registerInkMerger(registry: AssetMergerRegistry): void {
  registry.registerAssetMerger('ink', inkAssetMerger);
}

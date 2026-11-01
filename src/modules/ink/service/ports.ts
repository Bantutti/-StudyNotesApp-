/**
 * Ports the ink service depends on. The composition root adapts the real
 * Store and file system to these; tests use in-memory fakes. Keeping them
 * small means the service never sees SQL, Expo APIs or another module's
 * internals.
 */

/** Files under the app's private document directory. Paths are RELATIVE ("ink/a_….json"). */
export interface InkFilesPort {
  /** File text, or null when the file doesn't exist. */
  read(relPath: string): Promise<string | null>;
  /** Writes text so a crash leaves either the old or the new file, never half of one. */
  writeAtomic(relPath: string, text: string): Promise<void>;
  /** Deletes a file if it exists. */
  remove(relPath: string): Promise<void>;
  /** File names (not paths) directly inside a folder; [] when it doesn't exist. */
  list(relDir: string): Promise<string[]>;
}

/** The note fields the ink service needs. */
export interface InkNoteInfo {
  id: string;
  deleted: boolean;
  inkLayerRef: string | null;
}

/** The asset fields the ink service needs. */
export interface InkAssetInfo {
  id: string;
  deleted: boolean;
  size: number;
  localPath: string | null;
}

/** The slice of the Store the ink service uses (adapted in composition/ink.ts). */
export interface InkStorePort {
  getNote(noteId: string): Promise<InkNoteInfo | null>;
  getAsset(assetId: string): Promise<InkAssetInfo | null>;
  /** Creates the note's ink asset and links it, atomically. Returns the note's new `updated`. */
  createInkLayer(noteId: string, input: { id: string; localPath: string; size: number }): Promise<{ noteUpdated: number }>;
  /** New size after the published file was rewritten (one synced row update = one P2b upload). */
  setAssetSize(assetId: string, size: number): Promise<void>;
  /** Tombstones an asset (P2b deletes the cloud copy). */
  removeAsset(assetId: string): Promise<void>;
  /** Live ink assets no note points at any more. */
  inkOrphans(): Promise<InkAssetInfo[]>;
  /** Block ids of the note's current document AND every saved version (decision Q4 purge rule). */
  recoverableBlockIds(noteId: string): Promise<Set<string>>;
}

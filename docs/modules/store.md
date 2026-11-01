# Module: store

Local-first data on SQLite (expo-sqlite, works in Expo Go). Added in P1.

## Purpose
- Tables that copy P2a's cloud documents field for field, so P2b's sync is a straight copy.
- Full-text search (FTS5), one row per text block, so results open the note at the matching line.
- Version history, device settings (kv) and the synced profile settings.

## Public interface (`@/modules/store`)
| Export | What it does |
|---|---|
| `openStore(driver, { ids, logger, now? })` | Opens the database: per-connection pragmas, migrations, FTS secure-delete, profile row, purge of expired deletions. Returns the `Store`. |
| `openExpoDriver()`, `deleteExpoDatabase()` | The device adapter and file deletion for "Delete all data". |
| `Store.subjects / folders / notes / versions` | Create, read, update, delete with undo. Every write is one transaction. |
| `Store.search(text)` | Safe full-text search; results grouped by note with plain-text snippet parts. |
| `Store.kv`, `Store.settings` | Device-local settings; synced user settings (`users.settings`). |
| `Store.undo(token)`, `Store.purge()`, `Store.wipeAll()` | 8-second undo, wipe after the window, delete everything. |
| `MIGRATIONS`, `migrate`, `parseSearchQuery`, `cleanTitle`, `cleanTags`, `toHex6` | Lower-level pieces, exported for tests and P2b. |

## Tables (migration 1)
Synced (P2a names): `users, subjects, folders, notes, cards, reviewLogs, recordings, assets, stylePacks, templates`.
Timestamps are integer milliseconds, booleans 0/1, lists and capped JSON strings are TEXT holding JSON.
`owner` is NULL in guest mode; `rev` 0 means "never uploaded". `assets.localPath` is local only.
Local only: `noteVersions` (cascades with its note), `kv`, `searchMap` + `search` (FTS5).
No foreign keys between synced tables, because sync can deliver docs in any order.
All tables are `STRICT` with `CHECK`s on enums and booleans.

## Rules
- Every statement uses `?` placeholders; SQL text is never built from user data.
- Inside `db.transaction(tx => …)`, use `tx` only. The outer handle waits for the lock.
- Migrations are append-only: never edit a shipped migration, add the next number.
- Search input becomes quoted prefix terms (`"osmo"*`); FTS5 operators can't be injected.
  Snippet markers are U+E000/U+E001 (stripped from indexed text), never HTML.
- Names, titles and tags lose control characters, zero-width characters and bidi overrides,
  and are measured in UTF-16 units (the Firestore rules' count).
- Documents are saved through `prepareDocForSave` (core): schema check, non-null unique
  `blockId` on every block, and the cloud caps (600,000 characters, 900,000 bytes).
- Deleting keeps a tombstone for sync. After 8 seconds the text, versions and search rows are
  wiped (`secure_delete` on, FTS5 secure-delete where available).

## For P2b
`src/modules/store/__tests__/cloudContract.test.ts` has `toCloudDoc(row, uid)`, the reference
row-to-cloud mapping. It is checked against P2a's zod schemas whenever `firebase/` is present.

## How to extend
Add a migration with the next version number, a repository function that takes a `SqlExecutor`,
and a transaction-wrapped method on the `Store` facade. Tests run on Node's built-in SQLite
(`test/nodeSqlite.ts`).

## Assets (P4b)

`store.assets` manages the `assets` table (P2a's assets doc plus the local-only
`localPath`):

| Call | What it does |
|---|---|
| `get(id)`, `list(type)` | Read rows (`list` returns live rows only) |
| `createInkLayer(noteId, { id, localPath, size })` | Creates the note's ink asset **and** sets `notes.inkLayerRef` in one transaction. Refuses a second live layer. Returns the note's new `updated` |
| `update(id, { size?, localPath? })` | New size after the file was rewritten (bumps `updated`: a synced change) |
| `setLocalPath(id, path)` | Records where a downloaded file lives. **Doesn't** bump `updated`, because `localPath` never syncs |
| `remove(id)` | Tombstone (`deleted = 1`, `localPath` cleared). P2b deletes the cloud file |
| `inkOrphans()` | Live ink assets that no note points at (after P1's purge cleared `inkLayerRef`) |

Rules:
* `localPath` is relative to the documents folder and must match
  `LOCAL_PATH` (no `..`, no leading `/`).
* `size` is capped per type, the same as P2a's STORAGE caps.
* `cloudPath` and `owner` are only ever written by P2b's sync.


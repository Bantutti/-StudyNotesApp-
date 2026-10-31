# Cloud data model (P2a)

The source of truth is `firebase/src/schemas/collections.ts` (zod) together with `firebase/firestore.rules`. This page explains them. Sections are numbered **§D.x** for code comments.

## §D.1 Layout

**Firestore**, with top-level collections (Rey's decision, Nov 1 2026):

```
users/{uid}                profile (keyed by uid)
subjects/{id}   folders/{id}   notes/{id}   cards/{id}
reviewLogs/{id} recordings/{id} assets/{id} stylePacks/{id} templates/{id}
```

Every doc has `owner` (the uid). The rules require `owner == request.auth.uid` on every read and write, and every query must say `where('owner', '==', uid)` and `limit(≤ 500)`.

**Cloud Storage** is path-based:

```
users/{uid}/audio/{assetId}.m4a|aac|mp4
users/{uid}/images/{assetId}.jpg|jpeg|png|webp
users/{uid}/ink/{assetId}.json
users/{uid}/attachments/{assetId}.pdf
```

**Not in the cloud** (local only, per the plan): NoteVersion and AIJob. The rules deny any path for them.

## §D.2 Fields (Plan v0.2 §12 names, camelCased)

Every field is **required**. Absent values are `null`, never a missing key. The rules use `keys().hasAll()` plus `hasOnly()` and zod uses `strictObject`, so a doc always has exactly these keys.

**Common to every synced doc (§D.3):** `id, owner, schemaVersion, created, updated, rev, deleted`.

| Collection | Plan fields → cloud fields | Notes |
|---|---|---|
| users | id, ~~email~~, created, settings | + `owner`, `schemaVersion`, `updated`, `rev`, `deletionRequestedAt`. **Email is not stored** (Auth has it). `settings` is a JSON string ≤ 8,000. |
| subjects | name, color, icon, default pack → `defaultPack`, default template → `defaultTemplate`, exam dates → `examDates`, AI allowed → `aiAllowed`, auto-make cards → `autoMakeCards` | color is 6 hex digits; examDates ≤ 10 timestamps |
| folders | subject, name, parent | subject and parent are nullable entity ids |
| notes | subject, folder, title, document JSON → `document`, ink layer reference → `inkLayerRef`, style pack id → `stylePackId`, template id → `templateId`, tags, created, updated, deleted flag → `deleted` | `document` is a **JSON string** ≤ 600,000 (decision 3); inkLayerRef = asset id of type `ink` |
| cards | subject, note, source block id → `sourceBlockId`, type, front, back, source, source-changed flag → `sourceChanged`, suspended | + `deleted` tombstone (added). type: basic, reversed, cloze. source: definition, highlight, bookmark, ai, manual |
| reviewLogs | card, rating, reviewed at → `reviewedAt`, device | **append-only**: `id, owner, schemaVersion, created` but no updated, rev or deleted |
| recordings | note, asset, duration (ms), language, segments, bookmarks (ms) | `segments` is a JSON string ≤ 400,000: `[{id, start, end, text}]` in ms; asset is null after "delete audio" |
| assets | type, ~~local path~~, cloud path → `cloudPath`, size | **localPath is not synced** (it's a device path). Types add `ink` and `pdf` (§L.8.1). |
| stylePacks | version, definition, created-from-reference flag → `createdFromReference` | definition is a JSON string ≤ 50,000 |
| templates | version, definition | built-in templates (owner null in the plan) are bundled and never synced |

## §D.3 Lifecycle fields: how the sync module must write

| Field | On create | On update | Enforced by |
|---|---|---|---|
| `id` | = doc id | unchanged | rules |
| `owner` | = caller uid | unchanged | rules |
| `schemaVersion` | 1 | 1 | rules + zod |
| `created` | `serverTimestamp()` | unchanged | rules (`== request.time`) |
| `updated` | `serverTimestamp()` | `serverTimestamp()` | rules |
| `rev` | 1 | **old rev + 1** | rules |
| `deleted` | false | true or false | rules + zod |

**Conflict detection with `rev`.** A device that edits a note sends `rev = (rev it last saw) + 1`. If another device already saved in the meantime, the server's rev is higher, so this write is **denied**. The sync module treats that `permission-denied` on an update as a **conflict**: it fetches the server copy and runs the plan's resolver (Keep mine, Keep other, Keep both). This works with Firestore's offline queue, where transactions would not.

**Tombstones.** A delete is first an update to `deleted: true`, which every device syncs. A hard delete is allowed only for tombstones, or during account deletion, so last-writer-wins sync can't bring a deleted doc back.

**Server time.** `created` and `updated` are server timestamps. For last-writer-wins ordering and incremental pulls, use `updated`. The composite indexes `owner ASC, updated ASC` (and `owner, created` for reviewLogs) are in `firestore.indexes.json`.

**Profile first.** Every write requires `users/{uid}` to exist and not be mid-deletion. "Turn on sync" must create the profile before uploading anything.

**Batches.** Up to 500 writes per batch is fine. The profile check inside the rules is counted once per batch (verified in tests).

## §D.4 What lives inside the JSON strings (zod-only)

The rules can't parse JSON, so these checks must run **on load** (plan §17: "schema checks on load").

- §D.4.1: the document root is `{ "type": "doc", "content": [...] }`; nodes have only `type, attrs, content, text, marks`.
- §D.4.2: at most 64 levels deep and at most 50,000 nodes.
- §D.4.3: every **top-level block** has `attrs.id` (a stable block id), and ids are unique across the whole document.
- §D.4.4: optional `attrs.audioAnchor = { recordingId, startMs, endMs }` with `endMs ≥ startMs` (plan F11).
- Segments: `[{ id, start, end, text }]` with unique ids and `end ≥ start`.
- Pack and template definitions: must be a JSON object here. **The full style-pack v3 validator must also run on load.**

The editor (P1) owns the complete block schema. These are only the invariants the backend relies on.

## §D.5 Assets and files

1. Create (or update) the `assets/{id}` doc first: `type`, `size` (exact bytes), and `cloudPath = users/{uid}/{folder}/{id}.{ext}`.
2. Upload the file to exactly that path, with the right content type and no custom metadata.

Storage rules re-check the asset doc: same owner, not deleted, same path, **same byte size**, and the folder matches the type. So no untracked file can exist, and per-user storage can be totalled from asset docs. To replace a file (for example the ink layer), update `size` first, then overwrite.

## §D.6 Account-deletion state

`users/{uid}.deletionRequestedAt` is null normally, and a server timestamp while deletion runs.

- **While set:** every create, update and upload is denied, from every device. Live docs and review logs may be hard-deleted.
- **The profile is deleted last.** After that, writes stay impossible because the profile no longer exists.
- Full procedure: ACCOUNT_DELETION.md.

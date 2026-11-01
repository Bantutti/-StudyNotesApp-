# Backend limits and how they were derived (P2a)

Every number lives in `firebase/src/schemas/limits.ts`, and the same numbers are copied by hand into `firestore.rules` and `storage.rules`. The agreement test (`tests/rules/agreement.test.ts`) fails if zod and the rules ever disagree on a boundary. Code comments point here with **§L.x**.

> Changing a limit: edit `limits.ts`, then the matching line in the rules file(s), then run `npm test`. If you only change one side, the agreement test tells you which field disagrees.

---

## §L.1 Schema version

Every cloud doc stores `schemaVersion = 1`. The rules accept only `1`.

To migrate later: (1) add `2` to the rules' allowed set, (2) ship the app that writes version 2 and can still read version 1, (3) once old clients are gone, remove `1` from the rules.

## §L.2 Ids

| Kind | Pattern | Used for |
|---|---|---|
| Entity id | `^[A-Za-z0-9_-]{16,64}$` | ids of docs the app creates (notes, cards, …) |
| Ref id | `^[A-Za-z0-9_-]{1,64}$` | references that may name built-ins, e.g. `pastel-highlight`, `cornell` |
| Block id | `^[A-Za-z0-9_-]{1,64}$` | stable block ids inside the note document |
| uid | 1..128 chars | Firebase Auth uid (Auth's own maximum) |

**Why at least 16 characters for entity ids.** In top-level collections, ids share one namespace across all users (§S.2.3). An id has to be unguessable so nobody can guess someone else's ids, or claim them first ("squat"). Each character is one of 64 symbols, which carries log₂ 64 = 6 bits, so

- 16 characters → 16 × 6 = **96 bits** of space, if fully random;
- UUID v4 (36 characters, 122 random bits) and ULID (26 characters, 80 random bits plus a 48-bit time) both fit the pattern.

Guessing one specific 80-bit id has a chance of 2⁻⁸⁰ ≈ 8 × 10⁻²⁵ per try. **P1 and P2 must generate ids with at least 80 random bits.**

## §L.3 Small formats

- Colors: 6 hex digits with no `#`, the same convention as style-pack schema v3.
- Icons: `^[a-z0-9-]{1,40}$`. These are bundled icon keys and never URLs.
- Language: `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$`. ISO-639-1/2 codes plus an optional region, e.g. `en`, `tl`, `ceb`, `en-PH`. Groq Whisper takes ISO-639-1 (`tl`). Cebuano is `ceb`, which is ISO-639-2.

## §L.4 Text caps, and the unit they are measured in

| Field | Cap |
|---|---|
| Subject name, folder name | 80 |
| Note title | 200 |
| Tag | 40 |
| Card front, card back | 2,000 |

**Unit: UTF-16 code units, i.e. JavaScript `.length`.** This was verified in the emulator (`tests/rules/limits-probe.test.ts`):

| Value | UTF-16 units | Code points | UTF-8 bytes | Rules (cap 80) |
|---|---|---|---|---|
| 80 × `a` | 80 | 80 | 80 | accepted |
| 80 × `é` | 80 | 80 | 160 | accepted |
| 40 × 😀 | 80 | 40 | 160 | accepted |
| 41 × 😀 | 82 | 41 | 164 | **rejected** |

> ⚠️ **zod 4.6.7 counts differently.** `z.string().max(n)` counts **code points**, so a 41-emoji name passes zod but fails the rules at sync time. Our schemas use `utf16String(min, max)`, which measures `.length`. Any other synced schema in the app must do the same (see MERGE_NOTES).

## §L.5 List caps

| List | Cap | Rules check each item? |
|---|---|---|
| `notes.tags` | 20 strings of 1..40, unique | yes (written out item by item) |
| `subjects.examDates` | 10 timestamps | yes (written out item by item) |
| `recordings.bookmarks` | 500 ints (ms) | **no**, only the list size (zod checks the items) |

Rules have no loops, so checking every item means writing one check per position. That's practical for 10 or 20 items, not for 500 (§S.3.2).

## §L.6 Capped JSON strings (decision 3)

| Field | Cap (UTF-16 units) | Why |
|---|---|---|
| `notes.document` | 600,000 | must leave room in the 1 MiB doc (§L.6.1) |
| `recordings.segments` | 400,000 | §L.6.2 |
| `stylePacks.definition`, `templates.definition` | 50,000 | pack v3 files are about 3 to 6 KB |
| `users.settings` | 8,000 | small preferences object |

### §L.6.1 Why 600,000 characters plus a 900,000-byte cap for the document

Firestore's maximum document size is 1 MiB = 1,048,576 bytes. A string value costs its UTF-8 bytes + 1. The doc also stores field names, the other fields, and about 32 bytes of overhead plus the document name.

- **ASCII notes** (1 byte per unit): 600,000 units = 600,000 bytes. The other note fields add at most about 4 KB (title ≤ 200 units × 3 bytes, 20 tags × 40 × 3, plus ids). The total stays under 0.61 MiB, which is safe. The limit probe test stores a note at exactly 600,000 characters.
- **Non-ASCII notes**: one UTF-16 unit can be up to 3 UTF-8 bytes (e.g. `€`), and an emoji is 2 units = 4 bytes. So in the worst case 600,000 units = 1,800,000 bytes, and Firestore would reject it.
- **Fix:** zod also caps the document at **900,000 UTF-8 bytes**. That leaves 1,048,576 − 900,000 = 148,576 bytes for everything else in the doc. The app sees a clear "note too large" error before sending, instead of a failed write. Bytes are counted with `utf8ByteLength()`, which needs no `Buffer` or `TextEncoder`, so it runs on Hermes.

### §L.6.2 Inner caps (zod-only)

| Check | Cap | Reasoning |
|---|---|---|
| Document depth | 64 | Real notes nest 6 to 10 deep (doc → column → list → item → paragraph → text). 64 stops "JSON bomb" payloads. |
| Document nodes | 50,000 | About 10× a long lecture note |
| Segments | 5,000 | §L.7.1 |
| Segment text | 2,000 | One segment is a few seconds of speech |
| Definition depth | 12 | Pack v3 is about 3 levels deep |
| Settings depth | 4 | |

**Segments size check.** Whisper emits a segment every 3 to 10 s, so take 5 s. One segment as JSON is about 50 characters of keys and numbers plus about 70 characters of text (150 words per minute × 5 s ≈ 12.5 words ≈ 70 characters), so about 120 characters each.

- 90-minute lecture: 5,400 s ÷ 5 = 1,080 segments × 120 ≈ **130,000** characters. That fits easily.
- 400,000 ÷ 120 ≈ 3,333 segments × 5 s ≈ **4.6 hours** of continuous speech per recording.

## §L.7 Integers

| Field | Range | Reasoning |
|---|---|---|
| `rev` | 1 … 1,000,000,000 | At one save per second that's 31.7 years |
| `reviewLogs.rating` | 1 … 4 | FSRS: Again, Hard, Good, Easy |
| `recordings.duration`, bookmark ms | 0 … 21,600,000 | §L.7.1 |
| pack and template `version` | 1 … 10,000 | |

### §L.7.1 Six hours in ms

6 h × 3,600 s/h × 1,000 ms/s = **21,600,000 ms**.

## §L.8 Storage folders

| Folder | Content types | Extensions | Cap |
|---|---|---|---|
| `audio` | audio/mp4, audio/m4a, audio/x-m4a, audio/aac | m4a, aac, mp4 | 64 MiB |
| `images` | image/jpeg, image/png, image/webp | jpg, jpeg, png, webp | 5 MiB |
| `ink` | application/json | json | 5 MiB |
| `attachments` | application/pdf | pdf | 20 MiB |

SVG and HTML are deliberately missing, because both can carry scripts.

**Audio cap.** At the plan's AAC rate of 64 kbps mono:

- 64,000 bit/s ÷ 8 = 8,000 B/s, which is 480,000 B per minute ≈ 0.46 MiB per minute.
- 64 MiB = 67,108,864 B ÷ 8,000 B/s ≈ 8,389 s ≈ **2 h 19 min** per file.
- So a 90-minute lecture (≈ 43.2 MB) fits.

> **Open question for Rey.** `duration` allows up to 6 h (§L.7.1), but one audio file at 64 kbps stops at about 2 h 19 min, and the plan's Recording has a single `asset`. For classes longer than about 2 h 19 min, the options are: raise the audio cap to 128 MiB (≈ 4 h 39 min), lower the bitrate to 32 kbps, or let P4 store a recording as several assets.

**Images.** Plan F4 already downsizes and re-encodes images, so a 2048 px JPEG is usually 0.5 to 1 MB. 5 MiB is generous.

**Ink.** Vector strokes as JSON. A dense page has about 10,000 points × about 20 bytes ≈ 200 KB.

### §L.8.1 Asset types added beyond the plan

The plan lists Asset types `audio, image, sticker`. P2a adds **`ink`**, for the note's ink layer (`notes.inkLayerRef`), and **`pdf`**, for PDFs shared into the app ("stored as attachments", plan §17). Both are needed for these features to sync. **Waiting for Rey's OK**: removing them means deleting two enum values and their folders.

## §L.9 Query page size

The rules require every list query to have `limit ≤ 500`. That puts a ceiling of 500 document reads (plus index reads) on any single request. 500 is also Firestore's maximum batch size, so one page fits one batch.

## §L.10 Clock skew for review logs

`reviewedAt` comes from the device clock, because reviews happen offline. The rules allow it to be up to **5 minutes in the future** of server time, to absorb small clock drift. There is no lower bound, since a review made offline last week is valid.

## §L.11 What a user costs against the free quota (rough)

Firestore's free tier is 50,000 reads, 20,000 writes and 20,000 deletes per day **per project**.

- Every write also costs **1 read**, because the rules check the profile doc (`userActive()`). In a batch, that read is counted once.
- A full first sync for a heavy user (300 notes + 1,000 cards + 5,000 review logs) costs about 6,300 writes (+ about 13 profile reads, one per batch of 500).
- A full re-download for that user is about 6,300 reads. That's why the sync module must pull **incrementally** (`updated > lastSync`, using the composite indexes in `firestore.indexes.json`), not re-read everything.
- One Storage upload costs 2 Firestore reads (cross-service rules), plus 1 of the 5,000 free uploads per month.

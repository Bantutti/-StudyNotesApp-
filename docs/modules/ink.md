# Module: ink (P4b, drawing on notes)

**Status:** being built in P4b (branch `phase/p4b-ink`). M1 (model and
geometry), M2 (storage and service) and M3 (drawing finished ink on the
editor page) are done. Draw mode UI, tools, sketch block, sync hand-off and
the diagnostics screen follow in M4 to M9. The maths is in [INK_MATH.md](./INK_MATH.md). Code comments cite it as
§X.Y.

## Purpose

Lets students draw on a note with a stylus or a finger: pen, highlighter,
eraser and lasso, plus undo and redo. Strokes stay attached to the text they
were drawn on. They move when text above them grows, they survive edits,
undo, version restore and sync, and they render the same on phone and tablet.

## Design in one paragraph

Finished strokes live **inside the editor WebView** as SVG attached to their
anchor block (M3), so they scroll and reflow with the text natively and print
the same way (P6). The stroke being drawn right now is drawn by a **native
Skia overlay**, shown only in Draw mode (M4), for low latency. Both use the
same TypeScript outline code, so a stroke doesn't jump when it's committed.
Each note has **one JSON ink file**. It's validated with zod, capped at 4 MiB,
and treated as untrusted on load.

## Public interface (`src/modules/ink/index.ts`)

| Export | What it does |
|---|---|
| `InkLayer`, `InkStroke`, `InkTombstone` | The file format (below) |
| `parseInkJson(text, { expectedNote })` / `validateInkLayer(value)` | The **only** way to load ink. Checks size before parsing, then the strict schema, per-stroke checks and caps |
| `serializeInk(layer)` | Fixed key order, ASCII-only output (§6.3) |
| `emptyInkLayer(noteId)`, `inkUsage(layer)` | An empty layer; the share of the tightest cap used (warn at 90%) |
| `applyOp(layer, { remove, add }, ctx)` | The one write primitive: tombstones removals, gives re-added strokes fresh ids, refuses ops that would pass a cap |
| `createInkHistory()` | Undo and redo (100 steps per visit), with `remap()` for renamed strokes |
| `mergeInkLayers(a, b)` | The two-device merge (union with tombstones, §10) |
| `buildStrokes(input)` | Raw pen samples in page px → stored strokes (smooth, convert, simplify, split, encode) |
| `pickAnchor`, `strokeToPx`, `widthPx`, `reexpress`, `InkLayout` | Anchors (§9) |
| `reconcile(prevDoc, nextDoc, layer, prevLayout, ctx)` | Keeps strokes attached after text joins (§9.3) |
| `renderStroke`, `renderLayer`, `renderDiff`, `InkRenderItem` | Strokes → ready-to-draw path items for the editor page (and P6 export), cached per stroke |
| `routePointer`, `penCancelsTouch`, `pastScrollSlop` | Stylus-aware input routing and palm guards (worklets) |
| `createInkService(deps)`, `InkSession` | Loading, autosaving, publishing for sync, crash recovery, orphan sweep |
| `expoInkFiles` | The file adapter (expo-file-system, atomic writes) |
| `InkCanvas`, `summarizeInk`, `judgeInk` | P0 spike canvas and metrics, kept for the Ink diagnostics screen |

The composition root adapts the Store with `inkStorePort(store)` and creates
one service per Store with `inkServiceFor(store, deps)`
(`src/composition/ink.ts`).

## File format (v1)

```jsonc
{ "kind": "notedpo-ink", "v": 1, "note": "<noteId>", "unit": 1000,
  "strokes": [{
    "id": "s_<16..32 [A-Za-z0-9]>",   // immutable: an edit = tombstone + new id
    "b": "b_…",                        // anchor block (attrs.blockId)
    "tool": "pen" | "hl",
    "c": "p0" | "p1" | "p2" | "h0" | "#RRGGBB",  // pack key (restyles with the pack) or custom colour
    "w": 5..400,                       // width in tenths of a unit
    "o": [x0, y0],                     // first point, units from the block's top-left corner
    "d": [dx1, dy1, …],                // integer deltas (§6.1)
    "p": [0..100, …],                  // optional pressure, one per point
    "t": 1730450000000,                // created (ms)
    "rec": { "r": "<recordingId>", "ms": 12345 }  // optional, filled by P4 while recording
  }],
  "gone": [{ "id": "s_…", "t": 1730450001000 }]    // tombstones for the merge
}
```

**Units:** 1000 = the anchor block's width, on both axes (§1).
**Pens** use `p0` to `p2` (the pack's three ink pens), and the **highlighter**
uses `h0` (the pack's highlighter), so ink restyles with the pack the way text
highlights do. Custom colours are upper-case `#RRGGBB`.

### Caps (`INK_LIMITS`)

| What | Cap |
|---|---|
| File size | 4 MiB (the cloud allows 5 MiB) |
| Strokes per note | 10,000 |
| Points per stroke | 2,000 (longer gestures are split, §6.4) |
| Points per note | 400,000 |
| Tombstones | 5,000 (oldest compacted, §10.3) |
| Coordinates | x −1000..2000, y −50000..50000, step ≤ 4000 (§6.2) |
| Width | 5..400 tenths of a unit |
| Undo steps | 100 per note visit |

### Loading untrusted ink

`parseInkJson` runs these checks in order:
1. raw length ≤ 4 MiB **before** `JSON.parse`;
2. zod strict objects (unknown keys rejected);
3. per-stroke checks: integer deltas, step size, cumulative bounds, colour
   allowed for the tool, pressure length = point count;
4. unique ids, stroke, point and tombstone caps, and the note id.

**One bad stroke rejects the whole file.** The service keeps its last good
copy and reports `damaged` (the UI shows a banner). Error messages never echo
file content. A stroke that's also tombstoned is dropped instead of rejected
(the tombstone wins, as in a merge).

## Showing ink on the editor page (M3)

The page never reads ink files. Native turns each stroke into a **path item**
(`renderStroke`) in block units: highlighter and pressure-less pens become a
round-capped centreline (`mode: 'stroke'`), and pressure pens become a filled
outline (`mode: 'fill'`). The item crosses the bridge, and the page places it
in an `<svg viewBox="0 0 1000 1000">` over its block, so 1 unit = block width
/ 1000 px (§1.2). Items never need recomputing when the layout changes.

```
#root.pk
  #ink-under   highlighter strokes, behind the text   (z 0)
  #editor      TipTap                                  (z 1)
  #ink-over    pen strokes, on top of the text         (z 2)
```

The layers sit **outside ProseMirror's DOM**, so the editor never sees or
changes them. Each SVG is re-placed at most once per frame, after editor
transactions, resizes, pack and font changes. A stroke whose block is missing
is hidden, not deleted, so it comes back with its block (decision Q4).

**Bridge messages** (`src/modules/editor/protocol.ts`):

| Direction | Message | Purpose |
|---|---|---|
| → page | `inkAdd { items ≤ 500 }` | Draw items (same id = replace). Chunked by `chunkInkItems` to ~1.5 M chars |
| → page | `inkRemove { ids }`, `inkClear` | Remove strokes |
| → page | `setInkFeed { on }` | Draw mode: push layout after each change |
| → page | `requestInkLayout { reqId }` | Layout now |
| ← page | `inkLayout { originX/Y, viewport, pageWidth, blocks[] }` | Block boxes in page px (scroll-independent), with nesting depth, for anchoring |
| ← page | `inkAck { ids }` | Those strokes are drawn (native drops its live copy) |

**Security:** every item is checked by `inkItemSchema` on the page:
* path data may contain only `M L Q Z`, digits, space, `.` and `-`, at most
  200,000 characters (the same alphabet as `geometry/svg.ts`, kept equal by a
  test);
* colours are `p0` to `p2`, `h0` or `#RRGGBB`;
* ids and block ids must match their patterns;
* there are at most 10,000 strokes on the page (more gives `invalid_ink`).

Elements are built with `createElementNS` and set only with `setAttribute` or
`style.setProperty`; a test checks the source never uses `innerHTML`. Pack
colours become the CSS variables `--ink-p0` to `--ink-p2` and `--ink-h0`, set
from the validated pack, so ink restyles with the pack.

**After a WebView restart** (P1 r2 remounts it on Android render-process loss),
the screen must send `inkClear` and then `inkAdd(renderLayer(layer))` on every
`onReady`. *(The screen wiring comes with Draw mode in M4.)*

## Saving and sync (decision Q9)

| Copy | Path (relative to the documents folder) | Written | Synced |
|---|---|---|---|
| **Working** | `ink/work/<noteId>.json` | 1.5 s after the last change, on leaving Draw mode, on going to the background | No |
| **Published** | `ink/<assetId>.json` (= `assets.localPath`) | Only on **leaving the note**, and only if the bytes changed | Yes, by P2b |

* **Publishing** flushes the working copy, purges strokes that can't be
  recovered (§9.3), and writes the published file atomically. It then makes
  **one** synced row change:
  * first drawing on a note: `store.assets.createInkLayer` creates the asset
    and sets `notes.inkLayerRef` in one transaction;
  * later visits: `store.assets.update(size)`.

  P2b's triggers queue that one change, so a note is uploaded **at most once
  per visit** (Storage free tier: 5K uploads per month). The published file
  never changes while P2b may be uploading it.
* **Asset size** = published bytes, which P2a's Storage rule requires (§6.3).
* **Crash recovery:** at start-up, `recover()` publishes every leftover
  working copy. On open, a leftover working copy is **merged** with the
  published copy, so nothing drawn is lost.
* **Deleting a note:** P1's purge clears `notes.inkLayerRef` after the 8 s
  undo window. `sweepOrphans()` then tombstones the asset (P2b deletes the
  cloud file) and deletes the local file.
* **Delete all data** removes the whole `ink/` folder (`services.ts`
  `APP_FOLDERS`) and the `assets` rows.
* **Two devices:** P2b calls the ink merger (`registerAssetMerger('ink', …)`,
  being added by P2b) when an ink upload is rejected as stale or a newer copy
  is pulled. The merge is the union in §10. *(M8)*

## Privacy

Handwriting is note content:
* it's never logged (only event names and counts; a test checks this);
* it's not in diagnostics results;
* it's wiped by Delete all data;
* it's deleted with its note.

## Extending

* **A new tool** that changes strokes must go through `applyOp`, so undo, caps
  and tombstones work. Strokes are immutable: build a new stroke with a fresh
  id instead of editing one.
* **A format change** needs a new `v` and a migration in the loader. Old apps
  refuse files with a newer `v` (the schema uses `z.literal(1)`).
* **Testing:** Skia and Reanimated are replaced by small stubs in Jest
  (`test/mocks/`), so ink logic is tested directly. Drawing itself is checked
  on devices with the Ink diagnostics screen (M9) and TESTING_ON_DEVICE.

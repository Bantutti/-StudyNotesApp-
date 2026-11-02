# Phase report: P4b drawing and ink

| | |
|---|---|
| Phase | P4b, drawing and ink (Track B, Dev Engineer II worker). Plan approved by the Lead for Rey on Nov 1, 2026 (Q1 to Q11 all ★). Built under Rey's wind-down instruction (Nov 1, 4:40 PM): finish this phase, push, stop |
| Date | 2026-11-01 (Asia/Manila) |
| Zip | `{{ZIP_NAME}}` ({{ZIP_FILES}} files, {{ZIP_BYTES}} bytes) |
| SHA-256 | `{{ZIP_SHA256}}` |
| Revision | **r2**: `main` 33712d8 merged in (C1 #4, P3b #7, lint fix #11); two additive conflicts resolved (`APP_FOLDERS` keeps P3b's `ai` and P4b's `ink`; composition exports), docs merged. r1 (based on `main` 21b29b8) stays in Drive, superseded |
| Code | GitHub `Bantutti/-StudyNotesApp-`, branch `phase/p4b-ink`, PR #8, based on `main` 33712d8 |

> The copy of this report **inside** the zip shows the placeholders above, because a zip can't contain its own
> checksum. The real values are in `exports/<zip>.sha256` and in the copy uploaded next to the zip
> (`PHASE_REPORT-P4b.md`).

## 1. What was built

| Area | Built |
|---|---|
| Ink model (M1) | File format v1 (one JSON per note, block units, delta-coded integer points, optional pressure, tombstones) behind one validating loader; geometry (incremental smoothing identical live/committed, pressure width, variable-width outline, RDP, eraser and lasso hit tests, safe SVG paths); immutable layer ops with caps; undo/redo with id remapping; union merge (CRDT laws property-tested); anchors and reconcile for joined blocks; stylus-aware routing. Formulas in `docs/modules/INK_MATH.md` §1 to §10 |
| Saving (M2) | `store.assets` (incl. `createInkLayer`); ink service: local working copy while drawing, published copy once per visit (one synced row change), crash recovery, orphan sweep, damaged files never replace good ones |
| Page rendering (M3) | Finished strokes as SVG over their block inside the editor WebView (highlighter under the text, pens over it), schema-checked path items, layout feed for anchoring |
| Draw mode (M4) | Skia live-stroke overlay over the WebView (UI-thread gestures, same geometry as committed strokes, no flicker), palm guards, finger scroll after a stylus is seen, two-finger scroll and fling, pinch zoom 1x to 3x, tablet page width 760 px |
| Tools (M5) | Pen (3 pack pens, custom colours, 3 widths, pressure), highlighter, eraser (whole or partial), lasso (move with re-anchoring, recolour, delete), undo/redo (one gesture = one step), hidden drawings of deleted lines |
| Toolbars (M6) | Phone bottom bar; tablet floating pill docked left or right, draggable, side remembered; ⋯ menu (input mode, finger drawing, side, custom colour, sketch taller, hidden drawings, tips) |
| Sketch block (M7) | `sketch` node in core, editor and slash menu; ink clipped to the frame; export placeholder; **no `firebase/` change** (P2a's check is structural; contract test) |
| Sync hand-off (M8) | `inkAssetMerger` + `registerInkMerger` for P2b's `registerAssetMerger('ink')`; download on open through a port; both tested with fakes (two-device simulation) |
| Diagnostics (M9) | Developer menu > 6. Ink diagnostics: live metrics + palm test, latency clock, engine bench on synthetic strokes (labelled) |

## 2. How to run it

```powershell
npm ci
copy .env.example .env
npm run start:go
```

Open a note > **Draw**. On-device steps: `TESTING_ON_DEVICE.md` section 5 and section 8 "P4b". No native
modules were added, so everything runs in **Expo Go** on Android and iPhone and in the Android APK.

## 3. Checks (this sandbox: Linux, Node 24.22, npm 11.19, clean `npm ci`)

| Check | Result |
|---|---|
| `npm run verify` (editor page, typecheck, lint, tests, secret scan, prod audit) | Pass: **850 passed**, 10 skipped (P3a opt-in live AI tests) in 79 suites; `main` 33712d8 has 651, so **199 new P4b tests** |
| Editor page | Up to date: script 594,255 bytes, CSP `sha256-jMi6rg1N2Mj+tSiRLxF2GykAy0oIqrpLcNFHPnA8EWE=` |
| `npm run audit:prod` | 0 vulnerabilities |
| `npm run audit:all` | 7 low, dev-only, unchanged from `main` (no dependency changes) |
| `npm run bundle:check` | Android and iOS bundles build (8.5 MB each, with P3b) |
| New dependencies | **None** |
| Backend rules tests | Not re-run (no Java here); `firebase/` is unchanged by P4b |
| Device behaviour | **UNVERIFIED** (no device run yet): latency, palm rejection, rendering speed, gestures |

Engine bench reference (Linux/Node, synthetic, **not a device**): 5,000 strokes / 80,616 points / 1.23 MB;
open 382 ms, render 1,060 ms (shown in 500-stroke batches), eraser scan 19 ms, lasso 29 ms, merge 22 ms.

## 4. Security findings

See `docs/SECURITY.md` §2 "P4b controls" and §4d. **No open High or Medium issue.**

| ID | Severity | Status |
|---|---|---|
| P4b-S1 hostile ink files | Medium | Fixed by design (single validating loader; 24 rejection cases + seeded fuzz) |
| P4b-S2 markup injection into the page | Medium | Fixed by design (14-character path alphabet, no `innerHTML`) |
| P4b-S3 strokes lost in two-device conflicts | Medium | Fixed (union merger with tombstones) |
| P4b-S4 slow first render of very full drawings | Low | Fixed (batched) |
| P4b-S5 recolour dropped strokes from the selection | Low | Fixed (found by tests) |
| P4b-S6 upload quota and mid-upload changes | Low | Fixed by design |
| P4b-S7 strokes on not-yet-saved blocks purged | Low | Fixed (found in review) |
| P4b-S8 tombstone compaction | Low | Accepted, documented |
| P4b-S9 no encryption at rest | Low | Accepted with P1-S6 (P7) |
| P4b-S10 unverified on hardware | Info | Diagnostics screen |

## 5. Shared files touched

| File | Change |
|---|---|
| `src/app/note/[id].tsx` | Draw tab, ink overlay and toolbar, publish on leave, flush on background, ink on every editor ready |
| `src/modules/editor/protocol.ts`, `EditorView.tsx`, `index.ts` | Ink messages and handle methods, `sketch` / `sketchTaller` commands (additive) |
| `editor-web/src/main.ts`, `template.html`, `blocks.ts`, `commands.ts`, `menu.ts` | Ink layers, page movement, sketch node and menu item, overlay CSS, tablet page width |
| `src/modules/editor/generated/editorHtml.ts` | Regenerated (on conflict: `npm run build:editor`) |
| `src/core/document/schema.ts` | `sketch` node and `SKETCH_HEIGHT` |
| `src/modules/export/html.ts`, `docx.ts` | Sketch placeholder |
| `src/modules/store/store.ts`, `index.ts` (+ new `assets.ts`) | `store.assets`. **P2b adds `store.sync` here; whoever merges second rebases the index lines** |
| `src/composition/services.ts`, `index.ts` (+ new `ink.ts`, `noteInk.ts`) | `'ink'` added to Delete-all-data folders next to P3b's `'ai'`; exports next to P3b's |
| `src/app/dev/ink.tsx`, `src/app/dev/index.tsx` | Ink diagnostics screen |
| `jest.config.js`, `test/mocks/*` | Skia / Reanimated / Worklets stubs, Gesture Handler `jestSetup` |
| Shared docs | ARCHITECTURE, SECURITY, TESTING_ON_DEVICE, CHANGELOG, README, editor.md, store.md |

`strings.ts`, `me.tsx` and `_layout.tsx` weren't touched (ink text lives in `src/modules/ink/ui/strings.ts`).

## 6. Known limits

- **UNVERIFIED on hardware:** latency, palm-rejection thresholds (400 ms after pen lift, 150 ms pen-cancel,
  10 px scroll slop), Android/iOS pointer types and pressure, CSS zoom in the WebView, rendering speed.
  The Ink diagnostics screen collects the numbers.
- On two devices of different widths, text wraps differently, so a mark over a word can shift slightly
  (sketch blocks are exact; tablets use a fixed page width).
- Duplicating a block doesn't copy its ink. A lasso move re-anchors but doesn't resize or rotate.
- Apple Pencil double-tap/squeeze isn't supported (needs a native module and a development build).
- The sketch block grows by "Make taller" (+200 px), not by dragging its edge.
- Sync hand-off is built and tested against fakes. Wiring `registerInkMerger` and the download port into
  P2b's pipeline is a two-line composition change once P2b merges (`docs/modules/ink.md`, "Sync hand-off").

## 7. What's next

- Lead review and merge of PR #8. After P2b merges: call `registerInkMerger(sync.assets)` and pass P2b's
  download function to `inkServiceFor` (composition).
- P6: put ink into exports (`renderLayer` items inside each block's frame) and DOCX images.
- Rey's end-of-build device test: TESTING_ON_DEVICE §5 and §8 P4b; send the Ink diagnostics results.

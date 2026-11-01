# MERGE_NOTES: P5 → main

For the Lead when merging PR #10 (P5 style packs and Match a look).

## 1. State of the branch
- main **33712d8** (P1 #5, Gaegu fix #9, C1 #4, P3b #7, lint fix #11) is fully merged, through real GitHub
  merge commits (a2d0a00, cc28eac). The PR diff shows only P5's changes.
- The commits cb7f0cd and 6a536cd are temporary "main's version" commits that let GitHub merge cleanly. The
  commits right after them restore the resolved files. Review the diff as a whole.

## 2. Likely conflicts with phases still running
- **P2b (sync):** `src/composition/services.ts` (P5 adds `randomBytes`), `src/composition/index.ts`
  (P5 exports), `src/app/_layout.tsx` (keep `<CustomPackLoader />` directly inside `AppDataProvider`), and
  `src/app/(tabs)/me.tsx` (P5 only adds the "Font licences" row). Keep both sides. P2b's outbox triggers
  already cover `stylePacks`. Deleting a pack writes a tombstone whose definition is `'{}'`
  (`ERASED_DEFINITION`), which P2a's `stylePackSchema` accepts (tested).
- **P4b (ink):** packs keep the same `ink.pens` and `ink.highlighter` fields, and custom packs set them too
  (pens = ink, accent, accent2). No conflict expected.
- **P4 / P4c:** none expected.

## 3. After merging
- Run `npm run check:fonts` once on Windows. HarfBuzz output is deterministic, so the committed subsets should
  be "current".
- **C1:** the Android CAMERA permission now comes from expo-image-picker (asked only on "Take a photo"). There
  is no photo or media permission.

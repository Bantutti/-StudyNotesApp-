# lookmatch

**Purpose:** "Match a look" (plan F4, Flow 9). One to three reference photos become a validated
style pack (schema v3), shown as matched chips with a slider toward the nearest built-in pack,
then saved as a custom pack. The output is always pack DATA that `validatePack` accepts; never CSS,
HTML or URLs. Maths with derivations: `src/modules/lookmatch/MATCH_MATH.md` (code comments cite §X.Y).

Status: P5 in progress. M2 (image intake), M3 (on-device analysis), M4 (pack builder) and M5 (screens and saving) are done; M6 (vision pass) is coming.

## Public interface (so far)
- `intakeImages(picked, ports, { vision })`: checks, re-encodes, strips metadata, decodes, and
  deletes temp files. Returns `ReferenceImage[]` (`analysis` RGBA plus an optional clean
  `visionJpegBase64`).
- `checkPicked(picked)`, `IntakeError` (`problem` and `index`), `intakeMessage(e)`: plain-language errors.
- `stripJpegMetadata`, `metadataMarkers`, `isJpeg`, `JpegError`.
- `IMAGE_LIMITS` (all caps, see below).
- Expo adapters: `pickFromLibrary(max)`, `takePhoto()`, `expoImagePorts`.
- `analyzeImages(rgba[])` and `analyzeImagesAsync(rgba[], { onProgress, signal })`: the on-device pass
  (no key, no network). Returns a `LookAnalysis`: light or dark; paper colour, pattern (lined, grid,
  dotted or plain), line gap, pattern colour, margin (none, left or double) and texture; ink;
  accent and accent2; up to 4 highlighters (pen colour and opacity, plus what the photo shows); every
  palette swatch; and confidence (pattern strength, agreement between photos).

- `rankPacks(analysis, packs)`: built-in packs from nearest to farthest (§7).
- `buildPack({ id, name, analysis, base, choices?, hints? })`: a validated pack. The student's chip
  choices win, then vision hints (enums only), then the photo, then the nearest pack. It throws
  `PackBuildError` rather than ever returning an invalid pack.
- `blendPacks(matched, target, t)` and `blendSteps(...)`: the 11-step slider. Every step is valid (§9).
- `repairContrast(pack)` and `nudgeLightness(fg, bg, min)`: the smallest change that passes (§8).
- `newCustomPackId(randomBytes)`: `ref-` + 20 base32 characters (100 bits). This is valid as a pack
  id, as a custom id and as a P2a entity id.

## Building the pack (M4, MATCH_MATH.md §7-§9)
- **Nearest pack:** a weighted OKLab distance (paper ×3, accent ×1.5, ink, highlighters) plus
  penalties for light/dark, paper type, margin and texture. Synthetic round trip: 13/13 (the plan
  asks for at least 12/13).
- **Fields from the photo:** paper colour, pattern, line gap, margin, texture, ink, header colour,
  second accent and highlighters. **From the nearest pack:** fonts, header and block styles,
  decorations, the highlight key and highlighter meanings. Derived: muted, callout fill, pens.
- **Contrast repair** (§8): paper fixed, ink nudged, fills moved toward paper, accents nudged; then
  `validatePack`. Fuzz-tested: 1,000 random analyses give 1,000 valid packs.
- **Names:** the validator's text rule refuses markup, CSS and URLs (tested).

## On-device analysis (M3, MATCH_MATH.md §2-§6)
1. OKLab conversion and lighting flattened by tile medians (§2).
2. k-means (k = 14, fixed seed) on 6,000 samples per photo, pooled with equal weight per photo (§3, §6.1).
3. Roles: paper, ink, highlighters (un-blended to pen colour plus opacity), accent; the margin and
   pattern colours are excluded (§4).
4. Paper pattern from row and column medians and means, autocorrelation, a margin-strip test and a
   square-lattice test for dots (§5). Line gap is mapped relatively onto 22-34 (§5.4).
5. Votes across photos (§6.2).

**Measured on SYNTHETIC pages** (generated from the 13 packs with an 8% shadow and noise; not
photos): paper type and line gap 13/13 (gap within ±1), margin 13/13, light/dark 13/13, paper colour
within ΔE 0.02, ink within ΔE 0.04, pattern colour within ΔE 0.03, accent within ΔE 0.08 on at
least 10/13, highlighters found on 8/13. Very pale highlighters blend into the paper (known limit;
§4.3). Dense handwriting on plain paper stays plain. **Real photos are UNVERIFIED until Rey's device
test**, as is the speed on Hermes (budget: under 2 s for 3 photos).

## Image handling (P5 security: images are untrusted)
| Step | What | Why |
|---|---|---|
| Pick | System photo picker (Android Photo Picker, iOS PHPicker), `exif: false`, photos only. Camera permission is asked only when "Take a photo" is tapped | No photo-library permission at all (Q8 = A). iOS gets no `NSPhotoLibraryUsageDescription` |
| Check | 1-3 photos; JPEG, PNG, WebP or HEIC/HEIF; file at most 25 MiB; at most 50 MP (from metadata, BEFORE decoding); short side at least 64 px | Decompression bombs and huge files are refused before any decoding |
| Re-encode | `expo-image-manipulator` decodes already downsampled, then writes a new JPEG: 384 px long side, quality 0.92, for the analysis | New pixels, a new file, small memory |
| Strip | Pure-TS segment parser removes APP1-APP15 and COM (Exif/GPS, XMP, ICC, IPTC, comments), including between progressive scans, then re-checks that none are left | Location and camera data never survive, even if the re-encode kept some |
| Decode | React Native Skia `MakeImageFromEncoded` + `readPixels` (RGBA, unpremultiplied); the size must match what was asked | |
| Vision copy (M6, only when the vision pass runs) | 1,024 px, quality 0.8, stripped the same way, at most 1.5 M base64 chars, in memory only | |
| Clean up | Every manipulator output and the picker's cache copy is deleted in a `finally` block; only files under the app cache are ever deleted | Q5 = A: the reference photo is never kept or uploaded |

Errors never carry decoder text (it can contain file paths); the student sees "Photo 2 couldn't be
read. Try another photo."

**Unverified until Rey's device test:** EXIF absence in the manipulator's output on real phones (the
strip is the backup, tested on Pillow-made JPEGs carrying Exif GPS, XMP and a comment), and Skia
`readPixels` in Expo Go.

## Permissions (`app.json`, expo-image-picker plugin)
- `photosPermission: false` (the system picker needs none).
- `cameraPermission`: "NotedPo uses the camera only when you tap Take a photo in Match a look...".
- `microphonePermission`: the same text as expo-audio's. Setting it to `false` would BLOCK
  `RECORD_AUDIO` on Android and break lecture recording. The picker never records video.
- `READ/WRITE_EXTERNAL_STORAGE` stay blocked (P1's `android.blockedPermissions`).

## Screens and saving (M5)
- **Entry points:** + sheet > **Match a look** (`/match`), and the Style sheet's **Match a look from a photo**
  (`/match?note=<id>`, which previews and applies on that note).
- **Flow** (`runMatch`): pick (system picker or camera), clean, analyse (progress shown, Cancel), then rank
  the built-in packs and build a first matched pack, all in memory.
- **Result:** a live preview on the note (or the sample page); the closest built-in look; the 11-step
  **BlendStepper** ("Your photo" to the nearest pack, or to this note's look by tapping the swap
  button); the **chips** Paper, Paper colour, Ink, Header colour, Highlighters (keep or leave out each),
  Fonts (every pairing a built-in pack uses) and Header style (`chipOptions`). There is no free colour
  entry and every option is a schema value. Contrast is repaired after every change.
- **Save:** "Save and use on this note", "Save and use for this subject", or "Just save". Names go
  through `cleanPackName` (control, zero-width and bidi characters removed; at most 40 characters;
  markup, CSS and URLs refused).
- **Your looks** (`/looks`, linked from the Style sheet): rename (version + 1) or delete. Deleting
  leaves a tombstone with the definition erased; notes and subjects using the pack go back to Pastel
  Highlight, and the default look is reset if it was this pack.
- **Storage:** `store.stylePacks` (the local `stylePacks` table, fields 1:1 with P2a's cloud doc;
  definition capped at 50,000 characters; only `ref-` ids). P2b's triggers sync it. Every load
  re-validates each definition (`loadCustomPacks` -> `registry.setCustom`); tampered or unreadable rows
  are skipped and counted. `CustomPackLoader` reloads on every data change, including synced packs.

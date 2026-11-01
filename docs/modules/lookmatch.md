# lookmatch

**Purpose:** "Match a look" (plan F4, Flow 9). One to three reference photos become a validated
style pack (schema v3), shown as matched chips with a slider toward the nearest built-in pack,
then saved as a custom pack. The output is always pack DATA that `validatePack` accepts; never CSS,
HTML or URLs. Maths with derivations: `src/modules/lookmatch/MATCH_MATH.md` (code comments cite §X.Y).

Status: P5 in progress. M2 (image intake) is done; M3 to M6 are coming.

## Public interface (so far)
- `intakeImages(picked, ports, { vision })`: checks, re-encodes, strips metadata, decodes, and
  deletes temp files. Returns `ReferenceImage[]` (`analysis` RGBA plus an optional clean
  `visionJpegBase64`).
- `checkPicked(picked)`, `IntakeError` (`problem` and `index`), `intakeMessage(e)`: plain-language errors.
- `stripJpegMetadata`, `metadataMarkers`, `isJpeg`, `JpegError`.
- `IMAGE_LIMITS` (all caps, see below).
- Expo adapters: `pickFromLibrary(max)`, `takePhoto()`, `expoImagePorts`.

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

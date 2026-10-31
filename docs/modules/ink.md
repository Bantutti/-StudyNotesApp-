# ink

**Purpose:** pen and finger drawing with palm rejection and smoothness measurements.

**Public interface**
- `<InkCanvas ref mode color paper strokeWidth />` with handle `clear()`, `readStats()`, `resetStats()`.
- `acceptPointer(mode, pointerType, stylusSeen)` (worklet), `POINTER`, `InkMode` (`any`, `auto`, `stylus`).
- `emptyInkStats`, `summarizeInk(stats)` (frame p50/p95/max from a 1 ms histogram, dropped-frame %,
  samples per second, pressure range), `judgeInk(summary)`, `histPercentile`.

**How it works:** Gesture Handler 3 `usePanGesture` callbacks run as Reanimated worklets on the UI
thread. Skia 2 paths are immutable, so each stroke grows an `SkPathBuilder` and publishes `build()`
snapshots to shared values that the Skia `<Path>` draws; finished strokes are added to a second
builder. React never re-renders during a stroke.

**How to extend (P4b)**
- Per-touch palm rejection (palm first, pen second) with a manual gesture and touch ids.
- Variable stroke width from pressure (one path per stroke or a vertices mesh).
- Store strokes as data (points, pressure, pen index) attached to a block id.

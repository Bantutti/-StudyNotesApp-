# Ink maths (P4b companion document)

This document holds the formulas behind the ink module (`src/modules/ink`) and
shows where each one comes from. The code comments cite these sections as
**§X.Y**. If you change a formula, change the matching section here, and the
other way round.

Notation: points are `P = (x, y)`, optionally with a pressure `p ∈ [0, 1]`.
`|V|` is the length of vector `V`, `A·B` is the dot product, and
`clamp(v, lo, hi) = min(hi, max(lo, v))`.

---

## §1 Coordinates and units

### §1.1 Block units

Every stroke belongs to one **anchor block** (a paragraph, a heading, a list
item, a sketch block, and so on). Its points are stored in **block units**:

> 1000 units = the anchor block's width, on **both** axes.

Why the block's width:

* **Strokes survive edits.** When text above grows, the block moves down the
  page, and a stroke stored relative to the block moves with it.
* **Strokes scale across devices.** On a wider screen the block is wider, so
  one unit is more pixels, and the stroke grows in proportion.
* **Shape is preserved.** x and y use the same scale. A circle stays a circle,
  even when the block is much wider than it is tall.

The origin `(0, 0)` is the block's top-left corner. `x` normally lies in
`0..1000`. `y` grows downward and can be much larger than the block's height
(a stroke anchored to the nearest block above, in a margin).

### §1.2 Page pixels ↔ units

The editor reports each block's box `(left, top, width, height)` in CSS pixels
of the page (document coordinates, not affected by scrolling). With
`k = 1000 / width`:

```
u_x = (x_px − left) · k            x_px = left + u_x / k
u_y = (y_px − top)  · k            y_px = top  + u_y / k
```

These are exact inverses: substituting one into the other gives the identity.
A zero-width box would divide by zero, so the code uses `max(1, width)`.

### §1.3 Widths

Stroke widths are stored in **tenths of a unit** (`w`), so thin pens keep
sub-unit precision while staying integers:

```
w = round(width_px · (1000 / box.width) · 10)        width_px = (w / 10) · (box.width / 1000)
```

`w` is clamped to `5..400` (0.5 to 40 units).

---

## §2 Smoothing

### §2.1 Exponential moving average ("streamline")

Touch screens report noisy samples `r_0, r_1, …`. Each smoothed point moves a
fixed share `(1 − k)` of the way from the previous smoothed point toward the
new raw sample:

```
s_0 = r_0
s_i = s_(i−1) + (1 − k) · (r_i − s_(i−1)),     0 ≤ k < 1
```

Expanded, `s_i = (1 − k) · Σ_{j=0..i} k^(i−j) · r_j` (plus a `k^i r_0` term):
a weighted average where older samples count less and less. `k = 0` gives the
raw input; values closer to 1 give smoother lines with more lag. The app uses
`k = 0.5` for positions and `k_p = 0.6` for pressure (pressure sensors are
noisier).

**Why this filter (decision Q6).** `s_i` depends only on `s_(i−1)` and `r_i`.
The live overlay sees samples one at a time on the UI thread, and the commit
step sees them all at once. Both produce **exactly the same points**, so a
stroke never jumps when it's committed. A unit test checks this equality.

### §2.2 Lag and the final point

For a pen moving at constant velocity `v` per sample, the steady-state gap
between the raw and smoothed positions is

```
r_i − s_i → v · k / (1 − k)
```

(Set `e_i = r_i − s_i`. Then `e_i = k · e_(i−1) + k · v`, whose fixed point is
`e = k·v / (1 − k)`.) With `k = 0.5` the line trails the pen by about one
sample. So that the line ends exactly where the pen lifted, the last **raw**
sample is appended to the smoothed stroke.

---

## §3 Pressure and width

### §3.1 Width factor

Where the device reports pressure `p ∈ [0, 1]` (stylus), the local radius is
scaled by

```
f(p) = clamp(0.4 + 0.9 · p, 0.4, 1.3)
```

* `f(2/3) = 1`: a normal press draws the nominal width.
* A light touch never drops below 40%, so lines don't vanish.
* A hard press tops out at 130%.
* No pressure (finger, mouse): `f = 1`, so the stroke is constant width.

The mapping is linear, so equal pressure changes give equal width changes. The
clamp keeps faulty sensor values (below 0, above 1, NaN) safe.

---

## §4 Outlines and curves

A stroke whose width varies can't be drawn with a single SVG or Skia
"stroke", because those have one width. It's drawn as a **filled polygon**
around the centreline. Constant-width strokes (no pressure, and every
highlighter stroke) skip §4.1 to §4.3 and use a round-capped centreline path
(§4.4), which is smaller and exact.

### §4.1 Normals

For point `P_i`, the tangent is the direction from the previous point to the
next one. At the ends there is only one neighbour, so it's one-sided:

```
T_i = normalise(P_(i+1) − P_(i−1))      (P_(−1) := P_0, P_n := P_(n−1))
N_i = (−T_i.y, T_i.x)                    (T rotated by +90°)
```

The central difference is the standard second-order estimate of the curve's
direction. If two neighbours coincide (`|T| = 0`), the previous normal is
reused, so a repeated point never produces NaN.

### §4.2 Edges

With radius `r_i = (w / 2) · f(p_i)` (§3.1):

```
L_i = P_i + r_i · N_i        (left edge)
R_i = P_i − r_i · N_i        (right edge)
```

### §4.3 Caps and polygon order

The polygon is traced as one closed loop:

```
L_0 … L_(n−1)  →  end cap  →  R_(n−1) … R_0  →  start cap
```

Each cap is a half circle of radius `r` around the end point, split into 6
chords. With `θ = angle(N)`:

* **End cap**: from `L` (angle `θ`) through the forward direction `T` (angle
  `θ − π/2`, because `T` is `N` rotated by −90°) to `R` (angle `θ − π`). So it
  starts at `θ` and sweeps **−π**.
* **Start cap**: from `R` (angle `θ + π`) through the backward direction `−T`
  (angle `θ + π/2`) to `L` (angle `θ`). So it starts at `θ + π` and sweeps
  **−π**.

Sweeping the wrong way would trace each cap backwards, and the polygon would
cross itself. A test checks that a straight stroke gives a *simple* polygon
whose area is the capsule area `length · width + π r²` (within 3%).

A single point becomes a 12-gon (a dot). At sharp turns the two edges can
cross. Both renderers fill with the non-zero rule, so the overlaps stay solid.

### §4.4 Quadratic smoothing through midpoints

Both paths join their points with quadratic Béziers through segment
**midpoints**:

```
M P_0,  Q P_1 mid(P_1, P_2),  Q P_2 mid(P_2, P_3), …,  L P_(n−1)
```

Each curve starts and ends at a midpoint and uses the shared vertex as its
control point. A quadratic Bézier's end tangent points at its control point,
and the next curve's start tangent leaves through that same control point. So
consecutive pieces meet with a **continuous tangent** (G1). The curve stays
inside the polygon's convex hull, so it can't overshoot the way a spline
through the points can. Closed outlines use the same scheme around the loop.

---

## §5 Simplification (Ramer–Douglas–Peucker)

### §5.1 Algorithm

Keep the first and last points. Find the point farthest from the chord
between them (using §7.1). If that distance is greater than `ε`, keep it and
repeat on both halves; otherwise drop everything in between. The code uses an
explicit stack, so a 2,000-point stroke can't overflow the JS stack.

### §5.2 Error bound and ε

**Claim:** every dropped point lies within `ε` of the simplified polyline.

**Proof:** a point is dropped only while some chord `AB` is being processed,
and only when *every* point between `A` and `B` (that one included) is within
`ε` of `AB`. `AB` is a segment of the final polyline, because `A` and `B` are
both kept. ∎

The app uses `ε = 0.35` units, about 0.12 px on a 350 px phone block and
0.27 px on a 760 px tablet page. That's below a pixel, so the change can't be
seen, and typical strokes still shrink by 50 to 80%.

---

## §6 Storage encoding

### §6.1 Quantisation and delta coding

Points are stored as integers:

```
o   = (round(x_0), round(y_0))
d_i = (round(x_i) − round(x_(i−1)),  round(y_i) − round(y_(i−1)))
```

Rounding the **absolute** coordinates first, and only then taking
differences, means decoding by summation gives back exactly
`round(x_i)`. The error at every point is at most 0.5 units, and it **never
accumulates** along the stroke. (Rounding the differences instead would let
the errors add up like a random walk.) Steps that round to `(0, 0)` are
dropped, because they draw nothing.

Deltas are small numbers (usually 1 to 3 digits), so the JSON is roughly half
the size of absolute coordinates.

### §6.2 Bounds

Every decoded point must satisfy `−1000 ≤ x ≤ 2000` and
`−50000 ≤ y ≤ 50000`, and every step must satisfy `|d| ≤ 4000`. The encoder
clamps coordinates into range and subdivides longer steps into
`n = ceil(max(|dx|, |dy|) / 4000)` parts:

```
part_k = round(dx · k / n) − round(dx · (k − 1) / n)       k = 1..n
```

The parts sum (telescoping) to exactly `round(dx·n/n) − round(0) = dx`. Each
part is at most 4000, because `|dx| / n ≤ 4000` and the difference of two
rounded values that differ by at most an integer `M` is at most `M`. The
loader checks the same bounds as it decodes, so a crafted file can't create
huge coordinates.

### §6.3 ASCII and byte size

The file contains only fixed keys, ids and colours (ASCII by their regex
patterns) and integers. So `JSON.stringify` output is pure ASCII, and its
**character count equals its UTF-8 byte count**. The service uses
`text.length` as the asset size that P2a's Storage rule compares with the
upload. Per-stroke sizes are cached (strokes are immutable), so the
4 MiB check before every change costs `O(strokes)` additions, not a full
serialisation.

### §6.4 Splitting long strokes

A stroke holds at most 2,000 points. Longer gestures are split into runs that
**share their joint point** (run `j` starts at run `j−1`'s last point), so the
drawn line stays continuous. Runs are cut at 1,900 points: §6.2's
subdivision adds at most one point per 4,000 units of travel, which is at
most 25 within the coordinate bounds.

---

## §7 Eraser

### §7.1 Distance from a point to a segment

Project `P` onto the line through `A` and `B`, with `V = B − A`:

```
t = ((P − A)·V) / |V|²,   clamped to [0, 1]
d = |P − (A + t·V)|
```

Minimising `|A + tV − P|²` over `t` gives `t* = (P − A)·V / |V|²` (set the
derivative `2V·(A + tV − P)` to 0). Clamping keeps the closest point on the
*segment*. If `|V| = 0`, then `d = |P − A|`.

### §7.2 Does the eraser touch a stroke?

The eraser is a circle (centre `C`, radius `r`). A stroke drawn with
half-width `h` is touched when some segment comes within `r + h` of `C`.

### §7.3 Where a segment enters and leaves the circle

Solve `|A + tV − C|² = ρ²` with `W = A − C`:

```
(V·V) t² + 2 (V·W) t + (W·W − ρ²) = 0
t_(0,1) = (−b ∓ √(b² − 4ac)) / 2a,    a = V·V,  b = 2 V·W,  c = W·W − ρ²
```

The segment is inside the circle for `t ∈ [t_0, t_1] ∩ [0, 1]`. A negative
discriminant means it never enters.

### §7.4 Partial eraser

Walk the segments. Each inside interval from §7.3 cuts the polyline at
`A + t_0 V` and `A + t_1 V` (pressure interpolated linearly) and starts a new
piece. Pieces shorter than 1 unit (crumbs) are dropped. Each surviving piece
becomes a **new stroke with a new id**, and the original is tombstoned (§10).

---

## §8 Lasso

### §8.1 Point in polygon (ray casting)

Cast a ray from `P` toward `+x` and count the polygon edges it crosses. An odd
count means `P` is inside (Jordan curve theorem). An edge `(A, B)` counts when
`P.y` lies between `A.y` and `B.y` (half-open, so a shared vertex is counted
once), and the crossing point `x = A.x + (P.y − A.y)(B.x − A.x)/(B.y − A.y)`
is to the right of `P.x`. This works for concave lassos. Self-crossing lassos
follow the even-odd rule.

### §8.2 Selecting a stroke

A stroke is selected when at least **half** of its points are inside the
lasso. That's forgiving when a long stroke pokes out of a loose loop, and
strict enough that a lasso drawn near a stroke doesn't grab it.

---

## §9 Anchors

### §9.1 Choosing a block

When a stroke ends, its centre `c` (the centre of its bounding box) picks the
anchor:

1. the **deepest** block whose box contains `c` (ties: the smaller box), so a
   mark on a list item follows that item when the list is reordered;
2. otherwise the nearest **top-level** block whose top is above `c` (a margin
   note stays with the paragraph beside it);
3. otherwise the first top-level block.

### §9.2 Re-expressing a stroke on another block

To move a stroke from block `F` to block `G` without moving it on the page:
convert its points to page px with `F`'s box, add the move `(dx, dy)` if any,
then convert to units with `G`'s box (§1.2). The width is converted the same
way (§1.3). The page position changes by at most the quantisation error,
`0.5 · (G.width / 1000)` px per axis.

### §9.3 Reconcile after text edits

Edits that keep block ids (typing, moving blocks, Beautify, AI edits, turn-into,
splitting, where the top half keeps the id) need nothing. The one edit that
removes an id but keeps its text is a **join**. ProseMirror appends block
`X`'s text to the textblock `Y` just before it, and `X`'s id disappears. It's
detected by text:

```
text_after(Y) = text_before(Y) ⧺ text_before(X)
```

where `Y` is the textblock immediately before `X` in document order. `X`'s
strokes are then re-expressed on `Y` (§9.2), using the boxes from **before**
the edit, when both blocks were still laid out. `Y`'s top-left corner doesn't
move during a join, so the strokes stay where they were on the page.

Any other missing anchor means the block was deleted. Those strokes are
**detached**: hidden but kept, and they reappear by themselves if undo, a
version restore or sync brings the block back. They are purged (tombstoned)
only when no saved version contains that block id.

---

## §10 Merging two devices

### §10.1 The merge is a set union (a state-based CRDT)

Each layer is a pair `(S, G)`: live strokes keyed by id, and tombstoned ids.
Strokes are **immutable** (an edit is a tombstone plus a new id), so a given id
always means the same stroke. Then:

```
G = G_a ∪ G_b                    (same id: keep the later time)
S = (S_a ∪ S_b) \ G              (by id)
```

Union is commutative, associative and idempotent. Removing `G` afterwards
keeps those properties, because `G` is itself a union. So every device
converges to the same layer, whatever order the copies meet in. Strokes are
then sorted by `(created time, id)`, which gives the same drawing order on
every device. Seeded property tests check all three laws on random replicas.

### §10.2 A tombstone always wins

If one device erased a stroke that the other still has, the id is in `G` and
the stroke is removed from `S`. An erase is never undone by a merge. A
re-added stroke (undo of an erase) gets a **fresh id**, so it survives the
merge as a new stroke.

### §10.3 Tombstone compaction (the one exception)

At most 5,000 tombstones are kept, dropping the oldest first (ties broken by
id, so every device drops the same ones). The function "keep the newest N"
commutes with union, so the laws still hold for merges below the cap. A device
that stayed offline through more than 5,000 erasures could bring back a stroke
whose tombstone was dropped. That's an accepted, documented limit.

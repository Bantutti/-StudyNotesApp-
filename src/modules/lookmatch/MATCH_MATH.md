# Match a look: the maths

Companion to `src/modules/lookmatch`. Code comments cite these sections as §X.Y. Everything here
runs on the phone with no network. §10 (vision merge) is filled in at M6.

Notation: an image has width W and height H. Colours are sRGB with 8-bit channels (0-255) or
OKLab (L, a, b). ΔE is the OKLab distance (§1.3).

---

## §1 Colour spaces

### §1.1 sRGB transfer function
sRGB values are gamma-encoded. To do arithmetic on light we decode each channel c ∈ [0, 255]
to linear light (IEC 61966-2-1):

    s = c / 255
    lin(s) = s / 12.92                    if s ≤ 0.04045
           = ((s + 0.055) / 1.055)^2.4    otherwise

The inverse uses the knee 0.0031308 = 0.04045 / 12.92 so the two pieces meet. Image analysis
uses a 256-entry lookup table for lin(), because the input is always 8-bit.

(WCAG contrast in `stylepacks/color.ts` uses the same curve. The validator, and not this module,
decides whether a pack passes, so the two stay consistent.)

### §1.2 Linear sRGB to OKLab (Ottosson, 2020)
OKLab is designed so that straight-line distance roughly matches perceived difference, and so
that hue stays constant when lightness or chroma change. That makes it suitable for clustering
(§3), "nearest pack" (§7) and blending (§9). Conversion:

    [l m s]ᵀ   = M₁ · [r g b]ᵀ                 (linear sRGB → cone-like LMS)
    l' = ∛l,  m' = ∛m,  s' = ∛s                (compressive non-linearity)
    [L a b]ᵀ   = M₂ · [l' m' s']ᵀ

    M₁ = | 0.4122214708  0.5363325363  0.0514459929 |
         | 0.2119034982  0.6806995451  0.1073969566 |
         | 0.0883024619  0.2817188376  0.6299787005 |

    M₂ = | 0.2104542553  0.7936177850 -0.0040720468 |
         | 1.9779984951 -2.4285922050  0.4505937099 |
         | 0.0259040371  0.7827717662 -0.8086757660 |

The rows of M₁ sum to 1 and M₂ maps (1, 1, 1) to (1, 0, 0), so white is L = 1, a = b = 0. The
inverse applies M₂⁻¹, cubes, then applies M₁⁻¹ (constants in `color/oklab.ts`). Test values: sRGB
red → (0.62796, 0.22486, 0.12585), and every hex colour round-trips exactly (2,000 sampled).

### §1.3 Distance
    ΔE(x, y) = √((L₁−L₂)² + (a₁−a₂)² + (b₁−b₂)²)

Rough scale: 0.02 is just noticeable, 0.05 is clearly different, 0.1 or more is a different
colour. These thresholds appear throughout (merge 0.03, exclusion 0.05, highlighter separation 0.06).

### §1.4 Chroma and hue
    C = √(a² + b²)        h = atan2(b, a), in degrees (0-360)

Greys have C ≈ 0. Paper is usually C < 0.03 and clearly coloured inks are C > 0.05. Hue means
nothing when C is near 0.

### §1.5 Gamut mapping
A blended or averaged OKLab colour can fall outside sRGB (a channel below 0 or above 255).
Clipping each channel would shift the hue: a vivid pink clips toward orange. Instead we keep L and
h and shrink chroma by a factor t ∈ [0, 1], found by bisection (24 steps, precision 2⁻²⁴):

    find the largest t with toSRGB(L, t·a, t·b) ∈ [0, 255]³

t = 0 is a grey of the same L, which is always in gamut once L ∈ [0, 1]. Consequence: a hex shown
for a vivid, pale cluster can sit closer to grey than the cluster itself (see the Kawaii Pop note
in the analysis tests).

---

## §2 From pixels to samples

### §2.1 Conversion
The analysis copy (long side 384 px, `image/limits.ts`) is converted to OKLab in one pass into a
flat Float64Array (3 numbers per pixel), with no object allocated per pixel. Pixels with alpha
below 128 are marked "missing" (L = NaN) and skipped everywhere.

### §2.2 Flattening uneven lighting
Phone photos of paper are almost never evenly lit. Without correction, one sheet produces a
"light paper" and a "dark paper" cluster.

1. Split the image into 16 × 16 tiles and take each tile's **median** L. Writing covers well under
   half of any tile, so the median is the local paper lightness and ignores the ink.
2. The global paper lightness is the **90th percentile** of the tile medians. A shadow only ever
   darkens, so the best-lit tiles show the paper's real lightness. (Using the plain median
   left paper colours about 0.03 too dark under an 8% shadow; the 90th percentile brings that
   to about 0.013.)
3. Interpolate the tile medians bilinearly between tile centres into a smooth map P(x, y), so
   there are no seams.
4. Shift every pixel additively in L: L'(x, y) = L(x, y) + (P̂ − P(x, y)), where P̂ is the global
   value. The shift is additive because OKLab L is already close to perceived lightness. a and b
   (the colour itself) are unchanged.

### §2.3 Sampling for clustering
k-means does not need every pixel. A fixed stride ⌈N / 6000⌉ over the pixel index gives at most
6,000 samples per image. A fixed stride rather than a random one keeps the result deterministic.

---

## §3 Palette by k-means in OKLab

### §3.1 Seeding (k-means++) with a fixed seed
The first centre is a random sample. Each further centre is drawn with probability proportional to
D(x)², the squared distance from x to its nearest chosen centre. Spread-out seeds let small but
distinct colours, such as a highlighter stripe that is 2% of the page, get their own centre instead
of being absorbed by the paper. The "random" draws come from mulberry32, a 32-bit seeded
generator, with seed 0x5EED, so the same photos always give the same palette.

### §3.2 Lloyd iterations
Repeat until no centre moves more than 10⁻⁴ (ΔE), or for 20 rounds:
- assign each sample to its nearest centre (squared distance, so no square root is needed),
- move each centre to the mean of its samples. An empty cluster keeps its centre and ends with
  weight 0.

Cost: N·k·rounds = 18,000 · 14 · 20 ≈ 5 M distance computations for 3 photos.

### §3.3 Merging near-duplicates
Clusters closer than ΔE 0.03 are merged greedily, largest first, into a weight-averaged centre:

    c = (c₁w₁ + c₂w₂) / (w₁ + w₂),    w = w₁ + w₂

Because of this merge, k can be generous (k = 14). Too small a k absorbs pale highlighters into
the paper, while extra centres that turn out to be duplicates are simply merged.

---

## §4 Colour roles
Clusters smaller than 0.3% of the samples are noise and ignored.

### §4.1 Paper
The largest cluster. The page is light if L ≥ 0.5, otherwise dark (Dark Academia, Blackout Gel,
Chalkboard).

### §4.2 Ink
The cluster with the best score

    score = |L − L_paper| − 0.5·C + 0.5·min(0.2, w)

Ink is the colour most different from the paper in lightness. The −0.5·C term prefers greys,
because pens are usually black, blue-black or white gel. The weight term breaks ties toward body
text, the second-largest thing on the page. A blank page falls back to L = 0.2 (or 0.93 on dark
paper).

### §4.3 Highlighters
Candidates are clusters that are **more colourful than the paper** (C ≥ C_paper + 0.025), visibly
different from it (ΔE ≥ 0.06), and close to it in lightness (|ΔL| ≤ 0.22): a highlighter tints the
paper instead of covering it like ink. At most 4 are kept, each at least ΔE 0.06 from the others.

The photo shows the *composite* of the pen over the paper, channel by channel (the same alpha blend
as the validator's `composite()`):

    seen = α·pen + (1 − α)·paper   ⇒   pen = (seen − (1 − α)·paper) / α

We try α = 0.60 first and raise it in steps of 0.05 until every channel of `pen` falls in 0-255.
α = 1 always works (pen = seen). This gives a pen colour and opacity that reproduce what the photo
shows, and the pack's schema then clamps opacity to 0.25-1.

Known limit, measured on synthetic pages: very pale highlighters (C under about 0.05 after
compositing) fall into the paper cluster. Highlighters were found on 8 of 13 pack pages. The builder
(§7) fills the gaps from the nearest built-in pack, and the chip lets the student choose.

### §4.4 Accent (header colour)
The coloured clusters (C ≥ 0.05) that are not ink or highlighters and stand away from the paper in
lightness (|ΔL| > 0.13), ranked by C·√w: vivid beats faint, and size counts but with diminishing
returns. accent2 is the next one with a hue at least 40° away, else none (the pack keeps its own).

### §4.5 Exclusions
Colours the pattern pass already explained (§5.7) are not roles:
- the **margin rule** (often red or pink) is always excluded within ΔE 0.05, so it never becomes
  the header colour;
- the **ruling or dot colour** is excluded within ΔE 0.05, but only if it is close to the paper in
  lightness (|ΔL| < 0.3). A printed pattern is faint, so a strong colour near it must be ink, and
  this guard stops a mismeasured pattern from deleting the real ink.

---

## §5 Paper pattern
Darkness of a pixel relative to the paper: D(x, y) = s·(P̂ − L'(x, y)), with s = +1 on light paper
(lines are darker) and s = −1 on dark paper (lines are lighter).

### §5.1 Row and column profiles
For each row y and column x:
- **median** of D along it. This rises above 0 only if more than half the row is covered, which
  means a printed line crosses the whole row. Handwriting and dots cover far less than half a row,
  so they leave the median near 0, however dense the writing.
- **mean** of D along it. This also rises for dot rows and text rows.

### §5.2 Finding a repeat
For a profile f of length n, three steps:
1. **Clip** f at its 97th percentile, so a few spike rows (text lines that all start at the same
   x, a margin rule) can't dominate.
2. **Detrend**: subtract a centred 33-sample moving average. Slow changes, such as text only on the
   left half or a darker lower half, would otherwise correlate at every lag. Pattern spacings stay
   under about 24 px here, so they survive a 33-px window.
3. **Normalised autocorrelation**:

       r(k) = Σᵢ (fᵢ − f̄)(fᵢ₊ₖ − f̄) / Σᵢ (fᵢ − f̄)²

   so r(0) = 1, and a pattern repeating every P samples gives peaks at k = P, 2P, ....

The **period** is the first local maximum k ∈ [4, n/3] with r(k) ≥ 0.3 that also **repeats**,
meaning r(2k) > 0. Two lone spikes, like a double margin rule, give a high r at their separation
but nothing at twice it. Profiles flatter than std 0.002 (JPEG noise) have no period.

### §5.3 Decision rules
- **Line strength**: the median, over the strongest row in each period, of the row median must be
  at least 0.01 in L. A pale blue rule shrunk to 384 px is about 0.02-0.03; fainter repeats are
  shading or highlighter edges.
- **Margin test (horizontal patterns)**: the same spacing must also appear in at least one outer
  strip (left or right, at least 3% of the width or 1.2 periods wide), where nobody writes. The
  test uses a lattice match (below) on the strip's row profile.
- **Lattice match**: with row spacing P, the column profile's best r(k) for k within ±15% of P must
  be at least 0.3 and repeat at 2k. Printed grids and dots are square; letter spacing is irregular.

| row medians | column medians | row means + dot-row columns | result |
|---|---|---|---|
| periodic, strong, in strips | periodic, strong | | grid |
| periodic, strong, in strips | not | | lined |
| not | | periodic, lattice match (dot rows only) | dotted |
| otherwise | | | plain |

For dots, the column profile is averaged over the **dot rows** only: the local peaks of the clean
strip's profile that reach 30% of the typical (90th percentile) peak, so text between dot rows
doesn't dilute it. Measured on synthetic pages of all 13 packs (8% shadow, noise ±3): 13 of 13
correct, and dense writing on plain paper stays plain (4 seeds).

### §5.4 Line gap
The photo's scale is unknown, since it could be a close-up or the whole page, so the absolute
spacing can't be copied. The spacing relative to the image width, ρ = P / W, is mapped linearly
onto the schema's range and clamped:

    lineGap = round(22 + clamp((ρ − 0.025) / (0.06 − 0.025), 0, 1) · (34 − 22))

0.025 corresponds to narrow ruling on a whole page, 0.06 to wide or college ruling. Denser lines
in the photo give a smaller gap in the pack, which keeps the feel. Multiple photos use the median ρ
of the photos that agree on the type.

### §5.5 Margin rule
Columns in the left 25% where at least 55% of pixels have C ≥ 0.06 (red and pink rules are clearly
coloured) are margin columns. Adjacent hits within 2 px form one line. Two lines whose starts are
at most max(3 px, 4% of W) apart make a `double` margin, one line makes `left`, none makes `none`.

### §5.6 Texture
Noise left after flattening, on unmarked paper pixels (|D| ≤ 0.035): the median of |L(x) − L(x+1)|
over horizontal neighbours, sampled every second row and column. Above 0.012 the paper is textured:
`chalk` on dark paper, `grain` on light paper. Otherwise `none`. The median ignores stray marks.

### §5.7 Pattern colour
The median OKLab colour of pattern pixels:
- **lined or grid**: in the strongest row of each period, the pixels whose darkness is at least half
  that row's median darkness;
- **dotted**: inside the clean outer strip only, on the dot rows, the pixels darker than paper by
  more than 0.0175.

This colour becomes the pack's `paper.line` and is excluded from roles (§4.5). Measured within
ΔE 0.03 on all 10 patterned synthetic pages.

---

## §6 Several photos (decision Q4 = A, up to 3)

### §6.1 Pooled palette with equal weight
Each photo contributes the same number of samples (6,000, §2.3), so a large photo can't outvote
two small ones. All samples are pooled and clustered once (§3), giving one palette for the look.
A test checks that two cream photos outvote one larger white photo.

### §6.2 Votes
The paper type, margin and texture are decided per photo, then by majority vote. Ties go to the
earliest photo, the one the student picked first. `agreement` = votes for the winner / photos,
shown as a weaker chip when it is below 1. The pattern and margin colours come from the first
photo that agrees with the winning type.

### §6.3 Responsiveness
`analyzeImagesAsync` yields to the UI between photos and stages and can be cancelled. On a phone
the JS engine (Hermes) has no JIT, so the budget is under 2 s for 3 photos on a mid-range Android.
**UNVERIFIED until Rey's device test.**

---

## §7 Nearest pack and building the pack

### §7.1 Distance to a built-in pack
For an analysis A and pack P, lower is closer:

    d(A, P) = 3·ΔE(paper) + 1·ΔE(ink) + 1.5·ΔE(accent, if found) + 1·H(A, P)
            + 2·[appearance differs] + 0.25·[paper type differs] + 0.08·[margin differs] + 0.05·[texture differs]

The paper colour carries the most weight because it dominates what a page "looks like". The
categorical terms are penalties on the same scale (0.25 is about a clearly different colour).
Ties are broken by pack id, so the ranking is deterministic.

### §7.2 Highlighter term
H(A, P) is the mean, over the highlighters seen in the photo, of the distance to the closest
highlighter of P as it looks on P's paper (the validator's sRGB composite, §4.3). It is 0 when the
photo shows none.

Measured (synthetic round trip): a page drawn in pack X has X as its nearest pack for 13 of 13
packs. The test allows 1 miss, the plan's target.

### §7.3 Field sources
For each field, the first available source wins: the student's chip choice, then a vision hint
(M6, enums only), then the photo analysis, then the nearest pack. Fonts, header and block styles,
decorations, the highlight key and highlighter meanings come from the nearest pack unless a chip or
hint says otherwise. Highlighters found in the photo take the nearest pack's ids and meanings by
position; if none are found, the nearest pack's highlighters are used.

### §7.4 Derived colours
- muted = OKLab mix of ink toward paper by 0.35 (secondary text);
- soft (callout fill) = mix of paper toward accent by 0.08;
- a plain page still needs paper.line (schema): mix of paper toward ink by 0.12;
- pens = [ink, accent, accent2], and the ink-layer highlighter = the first highlighter's colour.

Then §8 repair, then `validatePack`. A pack that still fails throws instead of being returned.
1,000 random analyses (any colours, any pattern) against random nearest packs all pass.

## §8 Contrast repair
The schema v3 rules: ink on paper, on the callout fill and on every highlighter composited over
paper must be at least 4.5:1; muted on paper at least 4.5:1; accent, accent2 and each pen on paper
at least 3:1. Repair aims at min · 1.03, so rounding to #RRGGBB can't push a colour back under.

### §8.1 Lightness nudge (text and graphics on paper)
Keep a and b, move L toward 0 or 1, and find by bisection (30 steps) the smallest move that reaches
the target:

    find L* between L₀ and the extreme E with contrast(Lab(L*, a, b), bg) ≥ 1.03·min, |L* − L₀| minimal

E is 0 (darker) first on light backgrounds (L ≥ 0.6) and 1 otherwise. If that extreme cannot
reach the target, the other one is tried. Contrast is monotonic in L along this path, apart from
gamut mapping near the ends, so bisection finds the boundary. Example: a pale pink accent on white
becomes a deeper pink at 3.0-3.4:1, not black.

### §8.2 Fills under text (callout fill, highlighters)
Text sits on these, so we move the fill toward the paper instead of changing the ink again. A
highlighter first loses opacity in 0.05 steps down to the schema minimum of 0.25, which keeps the
pen's colour. Then its colour moves toward paper by the smallest t ∈ [0, 1] that passes:

    fill(t) = OKLab mix(fill, paper, t),    t = 1 gives the paper itself

t = 1 always passes, because ink on paper was fixed first.

### §8.3 Order
The paper is never changed (the student chose it). Then ink on paper; then the fills under ink
(soft, highlighters); then muted, accent, accent2 and the pens on paper. Each step only depends on
colours that were already fixed.

## §9 Blend slider (decision Q6 = A)
There are 11 positions t = 0, 0.1, ..., 1. t = 0 is the matched look and t = 1 the target (the
nearest built-in pack, or the note's current pack via a chip).

### §9.1 Colours
Linear in OKLab for each of L, a and b, then gamut-mapped (§1.5): c(t) = (1 − t)·c₀ + t·c₁. Blending
in OKLab keeps the middle steps from going muddy or grey, as sRGB blends of complementary colours do.

### §9.2 Numbers
Linear, then clamped and rounded to what the schema allows: lineGap is an integer in 22-34,
headerScale is in 1.5-2.8 at 0.01, and highlighter opacity is in 0.25-1 at 0.01.

### §9.3 Choices
Enums, fonts and booleans can't be "half": they come from the matched side for t < 0.5 and from the
target for t ≥ 0.5. A font's weight and style switch together with the font.

### §9.4 Highlighters
The side that wins at t (§9.3) sets how many there are. Each blends with the other side's
highlighter at the same position when there is one.

Every step is repaired (§8) and validated, so all 11 positions are valid packs (tested). The id,
name and meta always come from the matched side.

## §10 Vision pass and merge (M6, optional)
Rey approved this on Nov 1 (Q3 = A): Groq only, with `qwen/qwen3.8-27b`.

### §10.1 What the AI may say
The answer is a JSON object with exactly ten fields. Each one is a schema enum or `"unsure"`:
header style, divider, callout, definition box, bullet, washi, corner, doodle, columns
(`one`/`two`) and a font mood (13 moods, each mapped to a pairing that a built-in pack already
uses). There are no colours, numbers, names, text or URLs. The zod schema is strict, so unknown keys
fail. Groq gets the same schema as a strict JSON schema (constrained decoding), and a test checks that
the two list identical values.

Merge rule: a field the AI answers overrides the photo analysis and the nearest pack, but never
the student's chip choice (§7.3). `"unsure"` changes nothing. **Colours, paper and highlighters
always come from the on-device pass** (§2-§6): the AI only chooses design options.

### §10.2 Gates and limits (engine.describeImages)
Checked in this order, all before anything is sent:
1. the provider has a vision model and an image consent block (Groq only);
2. 1 to 3 images;
3. 18+ (P3b's birth-year gate);
4. the **image** consent for Groq at the catalog's current version (a text consent or an older version
   never counts);
5. a key;
6. online.

The adapter also refuses non-base64 images and images over 1.5 M characters. Each image counts as
2,048 input tokens on Groq: 3 images ≈ 6,144 tokens plus a short prompt and a 400-token answer,
inside the free plan's 8,000 tokens per minute.

### §10.3 Validation
`parseModelJson` (fences stripped), then zod. An invalid answer is asked once more, with a line
saying it didn't match. A second failure is an `invalid_output` error, and the screen keeps the
on-device look. Reasoning is off (`reasoning_effort: none`, `reasoning_format: hidden`), so the
content is only the JSON.

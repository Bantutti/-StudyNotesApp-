/**
 * Builds a style pack from an analysis (P5 M4, MATCH_MATH.md §7-§8).
 *
 * The output is ALWAYS pack data built field by field from enums, hex
 * colours and clamped numbers (never CSS, HTML, URLs or free text from the
 * photo), then contrast-repaired (§8) and checked by stylepacks'
 * validatePack. If validation still failed (a bug), buildPack throws
 * instead of returning an invalid pack; the fuzz test drives 1,000 random
 * analyses through it.
 *
 * Sources, in priority order, for every field:
 *   student's chip choice > vision hint (M6, enums only) > photo analysis > nearest built-in pack.
 */
import { ENUMS, validatePack, type StylePack } from '@/modules/stylepacks';

import type { LookAnalysis } from '../analysis/analyze';
import type { PaperType } from '../analysis/pattern';
import { mixHexOklab } from '../color/oklab';

import { repairContrast } from './repair';

/** What the student changed on the result screen (chips). Every value is re-validated by the schema. */
export interface MatchChoices {
  paperType?: PaperType;
  paperColor?: string;
  ink?: string;
  accent?: string;
  /** Use another built-in pack's whole font pairing (header + body + weights). */
  fonts?: StylePack['fonts'];
  headerStyle?: StylePack['header']['style'];
  /** Which found highlighters to keep, by index (default: all). */
  keepHighlighters?: readonly boolean[];
}

/** Enum-only hints from the vision pass (M6). Never colours, text or URLs. */
export interface VisionHints {
  headerStyle?: StylePack['header']['style'];
  divider?: StylePack['header']['divider'];
  callout?: StylePack['blocks']['callout'];
  definition?: StylePack['blocks']['definition'];
  bullet?: StylePack['blocks']['bullet'];
  washi?: StylePack['decor']['washi'];
  corner?: StylePack['decor']['corner'];
  doodle?: StylePack['decor']['doodle'];
  columns?: 1 | 2;
  fonts?: StylePack['fonts'];
}

export interface BuildInput {
  id: string;
  name: string;
  analysis: LookAnalysis;
  /** Nearest built-in pack (§7): fills everything the photo can't tell. */
  base: StylePack;
  choices?: MatchChoices;
  hints?: VisionHints;
}

export class PackBuildError extends Error {
  constructor(readonly errors: string[]) {
    super('pack_build_failed');
    this.name = 'PackBuildError';
  }
}

const DEFAULT_MEANINGS = ['Key idea', 'Definition', 'Example', 'Formula'];
const HL_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

/** Clamp to the schema's opacity range (0.25-1), 2 decimals. */
const clampOpacity = (o: number) => Math.round(Math.min(1, Math.max(0.25, o)) * 100) / 100;

/** §7.3 highlighters: the photo's (kept ones), with the nearest pack's ids and meanings by position. */
function buildHighlighters(a: LookAnalysis, base: StylePack, keep?: readonly boolean[]): StylePack['highlighters'] {
  const found = a.highlighters.filter((_, i) => keep?.[i] !== false);
  if (found.length === 0) return base.highlighters.map((h) => ({ ...h }));
  const used = new Set<string>();
  return found.slice(0, 6).map((h, i) => {
    const from = base.highlighters[i];
    let id = from && HL_ID.test(from.id) ? from.id : `hl-${i + 1}`;
    while (used.has(id)) id = `${id}-${i + 1}`;
    used.add(id);
    return { id, color: h.color, opacity: clampOpacity(h.opacity), meaning: from?.meaning ?? DEFAULT_MEANINGS[i] ?? 'Highlight' };
  });
}

/** Builds, repairs and validates. Throws PackBuildError if the result would not pass validatePack. */
export function buildPack(input: BuildInput): StylePack {
  const { analysis: a, base, choices: c = {}, hints: v = {} } = input;
  const paper = c.paperColor ?? a.paper.color;
  const ink = c.ink ?? a.ink;
  const accent = c.accent ?? a.accent ?? base.palette.accent;
  const accent2 = a.accent2 ?? base.palette.accent2;
  const type = c.paperType ?? a.paper.type;
  const highlighters = buildHighlighters(a, base, c.keepHighlighters);
  const fonts = c.fonts ?? v.fonts ?? base.fonts;

  const candidate: StylePack = {
    schema: 3,
    id: input.id,
    version: 1,
    name: input.name,
    meta: {
      mood: 'Matched from your photo',
      bestFor: base.meta.bestFor,
      trend: `Matched look, closest to ${base.name}`,
      appearance: a.appearance,
      tier: 'extra',
    },
    paper: {
      type,
      color: paper,
      // §7.4 a plain page still needs a line colour (schema); a faint mix of ink into paper.
      line: a.paper.line ?? mixHexOklab(paper, ink, 0.12),
      lineGap: a.paper.lineGap ?? base.paper.lineGap,
      margin: a.paper.margin,
      texture: a.paper.texture,
    },
    fonts: { ...fonts },
    palette: {
      ink,
      accent,
      accent2,
      muted: mixHexOklab(ink, paper, 0.35),
      soft: mixHexOklab(paper, accent, 0.08),
    },
    highlighters,
    highlightKey: { ...base.highlightKey },
    header: {
      style: c.headerStyle ?? v.headerStyle ?? base.header.style,
      divider: v.divider ?? base.header.divider,
    },
    blocks: {
      callout: v.callout ?? base.blocks.callout,
      definition: v.definition ?? base.blocks.definition,
      bullet: v.bullet ?? base.blocks.bullet,
    },
    decor: {
      washi: v.washi ?? base.decor.washi,
      corner: v.corner ?? base.decor.corner,
      doodle: v.doodle ?? base.decor.doodle,
    },
    ink: { pens: [ink, accent, accent2], highlighter: (highlighters[0] as { color: string }).color },
    layout: { columns: v.columns ?? base.layout.columns, margin: base.layout.margin },
  };
  return finalize(candidate);
}

/** §8 repair, then the validator decides. Exported for the blend slider. */
export function finalize(candidate: StylePack): StylePack {
  const repaired = repairContrast(candidate);
  // The pen of the first highlighter is the ink-layer highlighter (P4b reads ink.highlighter).
  repaired.ink.highlighter = (repaired.highlighters[0] as { color: string }).color;
  const report = validatePack(repaired);
  if (!report.ok || !report.pack) {
    throw new PackBuildError([...report.errors, ...report.contrast.filter((x) => !x.pass).map((x) => `${x.what}: ${x.ratio} < ${x.min}`)]);
  }
  return report.pack;
}

/** Enum lists for the chips (M5), straight from the schema so they can't drift. */
export const CHIP_ENUMS = {
  paperType: ENUMS.paperType,
  headerStyle: ENUMS.headerStyle,
} as const;

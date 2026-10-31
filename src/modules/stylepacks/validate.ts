/**
 * Full pack validation: schema, cross-checks and WCAG contrast rules
 * (port of StylePacks_v3/validate.js). Used for bundled packs today and for
 * imported or AI-generated packs in P5.
 */
import { composite, contrast } from './color';
import { stylePackSchema, type StylePack } from './schema';

export interface ContrastCheck {
  what: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  pass: boolean;
}

export interface PackReport {
  ok: boolean;
  pack: StylePack | null;
  errors: string[];
  contrast: ContrastCheck[];
}

export function contrastChecks(p: StylePack): ContrastCheck[] {
  const out: ContrastCheck[] = [];
  const add = (what: string, fgLabel: string, fg: string, bgLabel: string, bg: string, min: number) => {
    const ratio = contrast(fg, bg);
    out.push({ what, fg: fgLabel, bg: bgLabel, ratio: Math.round(ratio * 100) / 100, min, pass: ratio >= min });
  };
  const paper = p.paper.color;
  add('Body ink on paper', 'palette.ink', p.palette.ink, 'paper.color', paper, 4.5);
  add('Body ink on callout fill', 'palette.ink', p.palette.ink, 'palette.soft', p.palette.soft, 4.5);
  add('Muted text on paper', 'palette.muted', p.palette.muted, 'paper.color', paper, 4.5);
  add('Header colour on paper', 'palette.accent', p.palette.accent, 'paper.color', paper, 3);
  add('Second accent on paper', 'palette.accent2', p.palette.accent2, 'paper.color', paper, 3);
  for (const h of p.highlighters) {
    add('Body ink on highlighter', 'palette.ink', p.palette.ink, `highlighter "${h.id}"`, composite(h.color, paper, h.opacity), 4.5);
  }
  p.ink.pens.forEach((pen, i) => add('Ink pen on paper', `ink.pens[${i}]`, pen, 'paper.color', paper, 3));
  return out;
}

export function validatePack(raw: unknown): PackReport {
  const parsed = stylePackSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      pack: null,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'pack'}: ${i.message}`),
      contrast: [],
    };
  }
  const p = parsed.data;
  const errors: string[] = [];
  const ids = p.highlighters.map((h) => h.id);
  if (new Set(ids).size !== ids.length) errors.push('highlighters: ids must be unique');
  if (p.highlightKey.show && p.highlighters.some((h) => !h.meaning.trim())) {
    errors.push('highlightKey.show is true, so every highlighter needs a meaning');
  }
  const checks = contrastChecks(p);
  const ok = errors.length === 0 && checks.every((c) => c.pass);
  return { ok, pack: ok ? p : null, errors, contrast: checks };
}

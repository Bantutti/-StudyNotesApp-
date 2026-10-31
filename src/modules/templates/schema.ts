/**
 * Template schema v1 (plan F12, section 13).
 *
 * A template is DATA, never code or markup: a list of block specs from a
 * small closed set, plain-text strings (no markup, CSS or URLs), and a few
 * defaults. Unknown fields are rejected. Built-in templates are bundled and
 * validated at startup; user templates (v1.1) and synced templates go
 * through the same validator.
 */
import * as z from 'zod';

export const TEMPLATE_SCHEMA_VERSION = 1 as const;
const MAX_TEXT = 300;
const UNSAFE = /[<>{}]|url\(|https?:|javascript:|data:|@import/i;
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

const text = (max = MAX_TEXT) => z.string().max(max).refine((s) => !UNSAFE.test(s), 'contains markup, CSS or a URL');

/** Blocks allowed inside columns (no nested columns, no tables). */
const simpleSpec = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('heading'), level: z.union([z.literal(2), z.literal(3)]), text: text(120) }),
  z.strictObject({ kind: z.literal('paragraph'), text: text() }),
  z.strictObject({ kind: z.literal('bullets'), items: z.array(text()).min(1).max(12) }),
  z.strictObject({ kind: z.literal('numbered'), items: z.array(text()).min(1).max(12) }),
]);
export type SimpleSpec = z.infer<typeof simpleSpec>;

export const blockSpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('title'), text: text(120) }),
  /** Today's date as a line (formatted by the app at creation time). */
  z.strictObject({ kind: z.literal('date') }),
  z.strictObject({ kind: z.literal('heading'), level: z.union([z.literal(2), z.literal(3)]), text: text(120) }),
  z.strictObject({ kind: z.literal('paragraph'), text: text() }),
  z.strictObject({ kind: z.literal('bullets'), items: z.array(text()).min(1).max(12) }),
  z.strictObject({ kind: z.literal('numbered'), items: z.array(text()).min(1).max(12) }),
  z.strictObject({ kind: z.literal('callout'), text: text() }),
  z.strictObject({ kind: z.literal('definition'), term: text(120), text: text() }),
  z.strictObject({ kind: z.literal('summary'), text: text() }),
  z.strictObject({ kind: z.literal('qa'), question: text(), answer: text() }),
  z.strictObject({ kind: z.literal('quote'), text: text() }),
  z.strictObject({ kind: z.literal('divider') }),
  z.strictObject({
    kind: z.literal('columns'),
    layout: z.enum(['even', 'cornell']),
    left: z.array(simpleSpec).min(1).max(12),
    right: z.array(simpleSpec).min(1).max(12),
  }),
  z.strictObject({
    kind: z.literal('table'),
    header: z.array(text(60)).min(1).max(6),
    rows: z.number().int().min(1).max(20),
  }),
]);
export type BlockSpec = z.infer<typeof blockSpecSchema>;

export const templateSchema = z.strictObject({
  schema: z.literal(TEMPLATE_SCHEMA_VERSION),
  id: z.string().regex(ID),
  version: z.number().int().min(1).max(999),
  name: text(40),
  description: text(120),
  icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
  skeleton: z.array(blockSpecSchema).min(1).max(40),
  defaults: z.strictObject({
    /** Suggest card-making for this note's definitions (used in P4c). */
    autoCards: z.boolean(),
    /** Leave room for a lecture recording (used in P4). */
    recordingSlot: z.boolean(),
  }),
});
export type Template = z.infer<typeof templateSchema>;

export interface TemplateReport {
  ok: boolean;
  template: Template | null;
  errors: string[];
}

export function validateTemplate(raw: unknown): TemplateReport {
  const r = templateSchema.safeParse(raw);
  if (!r.success) {
    return { ok: false, template: null, errors: r.error.issues.map((i) => `${i.path.join('.') || 'template'}: ${i.message}`) };
  }
  return { ok: true, template: r.data, errors: [] };
}

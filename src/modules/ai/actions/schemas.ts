/**
 * Output schemas: what each AI action is allowed to answer.
 *
 * Every field is required (nullable where optional) and every object is
 * strict, so the same zod schema can be sent to the provider as a strict JSON
 * Schema (§4.4) and used on the device to validate the answer. The device
 * check is the one we trust: provider-side "strict" only helps the model.
 *
 * Limits: string lengths are checked again in code with `.length` (UTF-16
 * units) where they must match P2a's Firestore rules (card front/back 2,000).
 */
import * as z from 'zod';

import { AI_BLOCK_KINDS } from '../document/units';

/** Alias written by the AI: "u12" or the special "end". */
const ref = z.string().max(12);

export const aiBlockSchema = z.strictObject({
  kind: z.enum(AI_BLOCK_KINDS),
  term: z.string().max(200).nullable(),
  text: z.string().max(2_000),
});

/** Edit actions (beautify, clarify, simplify, translate, cleanTranscript, expand). */
export const editPlanSchema = z.strictObject({
  units: z
    .array(
      z.strictObject({
        ref,
        op: z.enum(['keep', 'replace', 'delete']),
        blocks: z.array(aiBlockSchema).max(20),
      }),
    )
    .max(400),
});
export type EditPlan = z.infer<typeof editPlanSchema>;

export const summarySchema = z.strictObject({
  title: z.string().max(120).nullable(),
  points: z.array(z.string().max(500)).max(12),
});
export type SummaryOut = z.infer<typeof summarySchema>;

export const keyTermsSchema = z.strictObject({
  terms: z
    .array(
      z.strictObject({
        term: z.string().max(200),
        definition: z.string().max(600),
        sourceRef: ref,
      }),
    )
    .max(30),
});
export type KeyTermsOut = z.infer<typeof keyTermsSchema>;

export const explainSchema = z.strictObject({
  paragraphs: z.array(z.string().max(1_500)).max(6),
});
export type ExplainOut = z.infer<typeof explainSchema>;

/** Card types and limits match P2a's cardSchema (firebase/src/schemas/collections.ts). */
export const CARD_TYPES = ['basic', 'reversed', 'cloze'] as const;
export const CARD_FRONT_MAX = 2_000;
export const CARD_BACK_MAX = 2_000;

export const cardsSchema = z.strictObject({
  cards: z
    .array(
      z.strictObject({
        type: z.enum(CARD_TYPES),
        front: z.string().max(CARD_FRONT_MAX),
        back: z.string().max(CARD_BACK_MAX),
        sourceRef: ref,
      }),
    )
    .max(30),
});
export type CardsOut = z.infer<typeof cardsSchema>;

export const quizSchema = z.strictObject({
  questions: z
    .array(
      z.strictObject({
        kind: z.enum(['mcq', 'short']),
        question: z.string().max(500),
        choices: z.array(z.string().max(200)).max(5),
        answerIndex: z.number().int().min(0).max(4).nullable(),
        answer: z.string().max(300),
        sourceRef: ref,
      }),
    )
    .max(20),
});
export type QuizOut = z.infer<typeof quizSchema>;

/**
 * §4.4 JSON Schema for the provider. zod's own converter is used, then the
 * result is reduced to the keywords every strict-mode implementation accepts
 * (type, properties, required, additionalProperties, items, enum, anyOf,
 * const, description). Length/size limits are enforced on the device instead,
 * so an unsupported keyword can never make the provider reject the request.
 */
const KEPT_KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'anyOf', 'const', 'description']);

export function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  const full = z.toJSONSchema(schema) as Record<string, unknown>;
  return reduceSchema(full) as Record<string, unknown>;
}

function reduceSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(reduceSchema);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (!KEPT_KEYWORDS.has(k)) continue;
    if (k === 'properties') {
      // Keys here are field names, not keywords: keep them all, reduce values.
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props[pk] = reduceSchema(pv);
      out[k] = props;
    } else {
      out[k] = reduceSchema(v);
    }
  }
  return out;
}

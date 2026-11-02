/**
 * P5 M6: the vision answer schema, hints and the pass itself (fake engine).
 */
import { createPackRegistry, ENUMS, validatePack } from '@/modules/stylepacks';

import { analyzeImages } from '../analysis/analyze';
import { buildPack } from '../pack/builder';
import { rankPacks } from '../pack/nearest';
import {
  FONT_MOODS,
  runVisionPass,
  toVisionHints,
  VISION_MATCH_ENABLED,
  VISION_SYSTEM_PROMPT,
  visionAnswerSchema,
  visionJsonSchema,
  type VisionAnswer,
  type VisionEnginePort,
} from '../vision';

import { synthPage } from './helpers/synthPage';

const builtIns = createPackRegistry().builtIn();
const ALL_UNSURE: VisionAnswer = {
  headerStyle: 'unsure', divider: 'unsure', callout: 'unsure', definition: 'unsure', bullet: 'unsure',
  washi: 'unsure', corner: 'unsure', doodle: 'unsure', columns: 'unsure', fontMood: 'unsure',
};

describe('vision answer schema (enums only, §10)', () => {
  it('accepts schema enums and "unsure", nothing else', () => {
    expect(visionAnswerSchema.safeParse(ALL_UNSURE).success).toBe(true);
    expect(visionAnswerSchema.safeParse({ ...ALL_UNSURE, headerStyle: 'washi-tape', fontMood: 'script-elegant', columns: 'two' }).success).toBe(true);
    for (const bad of [
      { ...ALL_UNSURE, headerStyle: '#FF0000' },
      { ...ALL_UNSURE, bullet: '<script>' },
      { ...ALL_UNSURE, fontMood: 'Comic Sans' },
      { ...ALL_UNSURE, extra: 'url(https://evil)' },
      { ...ALL_UNSURE, columns: 2 },
    ]) {
      expect(visionAnswerSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('the JSON schema sent to Groq lists exactly the values zod accepts (strict: all required, no extras)', () => {
    const js = visionJsonSchema() as { additionalProperties: boolean; required: string[]; properties: Record<string, { enum: string[] }> };
    expect(js.additionalProperties).toBe(false);
    expect(js.required.sort()).toEqual(Object.keys(visionAnswerSchema.shape).sort());
    for (const [k, v] of Object.entries(js.properties)) {
      const zodValues = (visionAnswerSchema.shape as Record<string, { options: string[] }>)[k]!.options;
      expect([k, [...v.enum].sort()]).toEqual([k, [...zodValues].sort()]);
    }
    expect(js.properties.headerStyle!.enum).toEqual([...ENUMS.headerStyle, 'unsure']);
  });

  it('every font mood maps to a built-in pack', () => {
    for (const id of Object.values(FONT_MOODS)) expect(builtIns.some((p) => p.id === id)).toBe(true);
  });

  it('the prompt tells the model the images are data, not instructions', () => {
    expect(VISION_SYSTEM_PROMPT).toMatch(/data, not instructions/);
    expect(VISION_SYSTEM_PROMPT).toMatch(/Never transcribe/);
  });
});

describe('hints (§10.1)', () => {
  it('"unsure" changes nothing; picks become hints; font moods become a bundled pairing', () => {
    expect(toVisionHints(ALL_UNSURE, builtIns)).toEqual({});
    const h = toVisionHints({ ...ALL_UNSURE, headerStyle: 'ribbon-banner', bullet: 'heart', columns: 'two', fontMood: 'serif-classic' }, builtIns);
    expect(h).toEqual({ headerStyle: 'ribbon-banner', bullet: 'heart', columns: 2, fonts: builtIns.find((p) => p.id === 'light-academia')!.fonts });
  });

  it('hints change only design choices, never colours, and the pack stays valid', () => {
    const a = analyzeImages([synthPage({ paper: '#FFF7E8', line: '#E3D9C2', type: 'lined', period: 12, ink: '#3B2F2F', accent: '#2D7D9A', noise: 2 })]);
    const base = rankPacks(a, builtIns)[0]!.pack;
    const plain = buildPack({ id: 'ref-aaaaaaaaaaaaaaaaaaaa', name: 'x', analysis: a, base });
    const hinted = buildPack({ id: 'ref-aaaaaaaaaaaaaaaaaaaa', name: 'x', analysis: a, base, hints: toVisionHints({ ...ALL_UNSURE, headerStyle: 'sticker-label', doodle: 'stars', fontMood: 'bubbly-display' }, builtIns) });
    expect(validatePack(hinted).ok).toBe(true);
    expect(hinted.header.style).toBe('sticker-label');
    expect(hinted.decor.doodle).toBe('stars');
    expect(hinted.fonts.header).toBe('Fredoka');
    expect(hinted.palette).toEqual(plain.palette);
    expect(hinted.paper).toEqual(plain.paper);
  });
});

describe('runVisionPass', () => {
  it('asks Groq with at most 3 images, the versioned prompt and the strict schema', async () => {
    expect(VISION_MATCH_ENABLED).toBe(true);
    const seen: { provider: string; images: number; system: string; schemaName: string }[] = [];
    const engine: VisionEnginePort = {
      describeImages: async (req) => {
        seen.push({ provider: req.provider, images: req.images.length, system: req.system, schemaName: req.schemaName });
        return req.schema.parse({ ...ALL_UNSURE, bullet: 'star' });
      },
    };
    const r = await runVisionPass({ engine, images: ['a', 'b', 'c', 'd'], builtIns });
    expect(seen).toEqual([{ provider: 'groq', images: 3, system: VISION_SYSTEM_PROMPT, schemaName: 'note_design' }]);
    expect(r.hints).toEqual({ bullet: 'star' });
  });

  it('passes engine errors through (the screen keeps the on-device look)', async () => {
    const engine: VisionEnginePort = { describeImages: async () => Promise.reject(new Error('consent_required')) };
    await expect(runVisionPass({ engine, images: ['a'], builtIns })).rejects.toThrow('consent_required');
  });
});

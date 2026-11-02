import { emptyInkLayer, inkUsage, parseInkJson, serializeInk, validateInkLayer, checkStroke } from '../model/format';
import { INK_LIMITS } from '../model/limits';
import { B1, NOTE, layerWith, rng, stroke } from './helpers';

describe('ink format: valid files', () => {
  it('round-trips a layer through serialize and parse, byte for byte', () => {
    const layer = layerWith(
      [stroke(), stroke({ tool: 'hl', c: 'h0', p: undefined }), stroke({ c: '#1F3A5F', p: [10, 20, 30, 40], rec: { r: 'r_0000000000000001', ms: 1234 } })],
      [{ id: 's_GONE000000000001', t: 5 }],
    );
    const json = serializeInk(layer);
    const r = parseInkJson(json, { expectedNote: NOTE });
    expect(r.ok).toBe(true);
    if (r.ok) expect(serializeInk(r.value)).toBe(json);
  });

  it('serializes with a fixed key order (same layer -> same bytes) and ASCII only', () => {
    const s = stroke();
    const shuffled = { t: s.t, d: s.d, o: s.o, w: s.w, c: s.c, tool: s.tool, b: s.b, id: s.id };
    expect(serializeInk(layerWith([shuffled]))).toBe(serializeInk(layerWith([s])));
    expect(/^[\x20-\x7e]*$/.test(serializeInk(layerWith([s])))).toBe(true);
  });

  it('drops strokes that are also tombstoned (the tombstone wins, like a merge)', () => {
    const s = stroke();
    const r = validateInkLayer(layerWith([s], [{ id: s.id, t: 1 }]));
    expect(r.ok && r.value.strokes).toEqual([]);
  });

  it('accepts an empty layer', () => {
    expect(parseInkJson(serializeInk(emptyInkLayer(NOTE))).ok).toBe(true);
  });
});

describe('ink format: rejected files (untrusted input)', () => {
  const bad = (mutate: (l: Record<string, unknown>) => void) => {
    const l = JSON.parse(serializeInk(layerWith([stroke()]))) as Record<string, unknown>;
    mutate(l);
    return parseInkJson(JSON.stringify(l));
  };
  const firstStroke = (l: Record<string, unknown>) => (l.strokes as Record<string, unknown>[])[0] as Record<string, unknown>;

  it.each([
    ['unknown top-level key', (l: Record<string, unknown>) => (l.extra = 1)],
    ['wrong kind', (l: Record<string, unknown>) => (l.kind = 'other')],
    ['future version', (l: Record<string, unknown>) => (l.v = 2)],
    ['wrong unit', (l: Record<string, unknown>) => (l.unit = 500)],
    ['bad note id', (l: Record<string, unknown>) => (l.note = '../x')],
    ['unknown stroke key', (l: Record<string, unknown>) => (firstStroke(l).html = '<b>')],
    ['bad stroke id', (l: Record<string, unknown>) => (firstStroke(l).id = 'x')],
    ['bad block id', (l: Record<string, unknown>) => (firstStroke(l).b = 'b_!!')],
    ['unknown tool', (l: Record<string, unknown>) => (firstStroke(l).tool = 'brush')],
    ['css colour', (l: Record<string, unknown>) => (firstStroke(l).c = 'red')],
    ['lower-case hex', (l: Record<string, unknown>) => (firstStroke(l).c = '#abcdef')],
    ['pen with highlighter key', (l: Record<string, unknown>) => (firstStroke(l).c = 'h0')],
    ['width too big', (l: Record<string, unknown>) => (firstStroke(l).w = 401)],
    ['non-integer width', (l: Record<string, unknown>) => (firstStroke(l).w = 3.5)],
    ['odd delta count', (l: Record<string, unknown>) => (firstStroke(l).d = [1, 2, 3])],
    ['non-integer delta', (l: Record<string, unknown>) => (firstStroke(l).d = [1.5, 2])],
    ['step too long', (l: Record<string, unknown>) => (firstStroke(l).d = [INK_LIMITS.maxStep + 1, 0])],
    ['out of bounds after decoding', (l: Record<string, unknown>) => (firstStroke(l).d = [1900, 0, 1900, 0])],
    ['string delta', (l: Record<string, unknown>) => (firstStroke(l).d = ['1', 2])],
    ['pressure length mismatch', (l: Record<string, unknown>) => (firstStroke(l).p = [1, 2])],
    ['pressure out of range', (l: Record<string, unknown>) => (firstStroke(l).p = [0, 0, 0, 101])],
    ['negative time', (l: Record<string, unknown>) => (firstStroke(l).t = -1)],
    ['bad recording anchor', (l: Record<string, unknown>) => (firstStroke(l).rec = { r: 'r_1', ms: 0 })],
    ['duplicate tombstone', (l: Record<string, unknown>) => (l.gone = [{ id: 's_GONE000000000001', t: 1 }, { id: 's_GONE000000000001', t: 2 }])],
  ])('rejects %s', (_name, mutate) => {
    const r = bad(mutate);
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate stroke ids', () => {
    const s = stroke();
    expect(validateInkLayer(layerWith([s, { ...s }])).ok).toBe(false);
  });

  it('rejects a layer for another note when the note is known', () => {
    expect(parseInkJson(serializeInk(layerWith([stroke()])), { expectedNote: 'n_0000000000000002' }).ok).toBe(false);
  });

  it('rejects an oversized file BEFORE parsing it', () => {
    const spy = jest.spyOn(JSON, 'parse');
    const r = parseInkJson(' '.repeat(INK_LIMITS.maxFileBytes + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('too_large');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejects malformed JSON without throwing', () => {
    expect(parseInkJson('{"kind":').ok).toBe(false);
  });

  it('never echoes file content in its error message', () => {
    const r = parseInkJson(JSON.stringify({ secret: 'my handwriting text' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).not.toContain('handwriting');
  });

  it('rejects more points than the per-stroke cap', () => {
    // maxPoints points = (maxPoints - 1) delta pairs: allowed. One more pair: rejected.
    const pairs = (n: number) => Array.from({ length: n * 2 }, (_, i) => (i % 4 === 0 ? 1 : i % 4 === 2 ? -1 : 0));
    expect(validateInkLayer(layerWith([stroke({ o: [0, 0], d: pairs(INK_LIMITS.maxPointsPerStroke - 1) })])).ok).toBe(true);
    expect(validateInkLayer(layerWith([stroke({ o: [0, 0], d: pairs(INK_LIMITS.maxPointsPerStroke) })])).ok).toBe(false);
  });

  it('seeded random mutations never throw and never pass unvalidated values', () => {
    const r = rng(42);
    const base = serializeInk(layerWith([stroke({ p: [1, 2, 3, 4] }), stroke({ tool: 'hl', c: 'h0' })]));
    const junk = ['', 'null', '-1', '1e309', '"x"', '{}', '[]', 'true', '99999999999'];
    for (let i = 0; i < 500; i++) {
      // Replace one random number-or-token position with junk.
      const pos = Math.floor(r() * base.length);
      const mutated = base.slice(0, pos) + (junk[Math.floor(r() * junk.length)] as string) + base.slice(pos + 1);
      expect(() => parseInkJson(mutated)).not.toThrow();
      const res = parseInkJson(mutated);
      if (res.ok) for (const s of res.value.strokes) expect(checkStroke(s)).toBeNull();
    }
  });
});

describe('ink usage', () => {
  it('reports the share of the tightest cap', () => {
    const l = layerWith([stroke()]);
    expect(inkUsage(l)).toBeGreaterThan(0);
    expect(inkUsage(l)).toBeLessThan(0.01);
    expect(inkUsage(l, INK_LIMITS.maxFileBytes)).toBe(1);
  });
  it('B1 helper is a valid block id', () => {
    expect(validateInkLayer(layerWith([stroke({ b: B1 })])).ok).toBe(true);
  });
});

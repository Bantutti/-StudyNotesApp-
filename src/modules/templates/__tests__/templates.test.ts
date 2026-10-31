import { createSeqIdGenerator, listBlockIds, prepareDocForSave, SAMPLE_NOTE, validateNoteDoc, BLOCK_ID, type IdGenerator } from '@/core';

import { applyTemplateTo, BUILTIN_TEMPLATES, createTemplateRegistry, formatTemplateDate, instantiateTemplate, validateTemplate } from '../index';

/** Distinct prefix per generator so collisions would show. */
function gen(tag: string): IdGenerator {
  let n = 0;
  return { newId: (p) => `${p}_${tag}${String(++n).padStart(12, '0')}` };
}
const opts = (tag = 'aaaa') => ({ ids: gen(tag), dateText: 'Sunday, 1 November 2026' });

describe('built-in templates', () => {
  const reg = createTemplateRegistry();

  it('all 7 validate', () => {
    expect(reg.rejected).toEqual([]);
    expect(reg.list().map((t) => t.id)).toEqual(['lecture', 'cornell', 'outline', 'vocabulary', 'lab-report', 'problem-set', 'reading-notes']);
  });

  for (const t of createTemplateRegistry().list()) {
    it(`${t.id}: makes a valid note where every block has a unique id`, () => {
      const doc = instantiateTemplate(t, opts());
      expect(validateNoteDoc(doc).ok).toBe(true);
      const ids = listBlockIds(doc);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => BLOCK_ID.test(id))).toBe(true);
      expect(prepareDocForSave(doc, createSeqIdGenerator()).ok).toBe(true);
    });
  }

  it('two notes from the same template never share block ids', () => {
    const t = reg.get('cornell')!;
    const a = listBlockIds(instantiateTemplate(t, opts('aaaa')));
    const b = listBlockIds(instantiateTemplate(t, opts('bbbb')));
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it('fills the date line', () => {
    const doc = instantiateTemplate(reg.get('lecture')!, opts());
    expect(JSON.stringify(doc)).toContain('Sunday, 1 November 2026');
    expect(formatTemplateDate(new Date(2026, 10, 1).getTime())).toBe('Sunday, 1 November 2026');
  });

  it('Cornell uses the cornell column layout and a summary', () => {
    const doc = instantiateTemplate(reg.get('cornell')!, opts());
    expect(doc.content.map((n) => n.type)).toEqual(['heading', 'paragraph', 'columns', 'summary']);
    expect(doc.content[2]).toMatchObject({ attrs: { layout: 'cornell' } });
  });
});

describe('applying a template to a note', () => {
  const t = createTemplateRegistry().get('outline')!;

  it('keeps every existing block id and adds sections below (no extra title)', () => {
    const before = listBlockIds(SAMPLE_NOTE);
    const doc = applyTemplateTo(SAMPLE_NOTE, t, opts());
    const after = listBlockIds(doc);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBeGreaterThan(before.length);
    expect(doc.content.slice(SAMPLE_NOTE.content.length).some((n) => n.type === 'heading' && n.attrs.level === 1)).toBe(false);
    expect(validateNoteDoc(doc).ok).toBe(true);
  });

  it('replaces an empty note entirely', () => {
    const empty = { type: 'doc' as const, content: [{ type: 'paragraph' as const, attrs: { blockId: 'b_emptyemptyempt' } }] };
    const doc = applyTemplateTo(empty, t, opts());
    expect(listBlockIds(doc)).not.toContain('b_emptyemptyempt');
    expect(doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
  });
});

describe('template validation (templates are data, never markup)', () => {
  const base = BUILTIN_TEMPLATES[2] as Record<string, unknown>;

  it('rejects markup, CSS, URLs and unknown fields', () => {
    const bad = (patch: Record<string, unknown>) => validateTemplate({ ...base, ...patch }).ok;
    expect(bad({ name: '<b>x</b>' })).toBe(false);
    expect(bad({ description: 'see https://evil.example' })).toBe(false);
    expect(bad({ skeleton: [{ kind: 'paragraph', text: 'javascript:alert(1)' }] })).toBe(false);
    expect(bad({ skeleton: [{ kind: 'html', html: '<script>' }] })).toBe(false);
    expect(bad({ skeleton: [{ kind: 'paragraph', text: 'x', style: 'color:red' }] })).toBe(false);
    expect(bad({ extra: true })).toBe(false);
    expect(bad({ skeleton: [] })).toBe(false);
  });

  it('rejects nested columns and oversized tables', () => {
    const cols = { kind: 'columns', layout: 'even', left: [{ kind: 'columns' }], right: [{ kind: 'paragraph', text: 'x' }] };
    expect(validateTemplate({ ...base, skeleton: [cols] }).ok).toBe(false);
    expect(validateTemplate({ ...base, skeleton: [{ kind: 'table', header: ['a'], rows: 500 }] }).ok).toBe(false);
  });

  it('a registry skips invalid and duplicate templates', () => {
    const reg = createTemplateRegistry([base, base, { ...base, id: 'x y' }]);
    expect(reg.list()).toHaveLength(1);
    expect(reg.rejected).toEqual(['template #1', 'template #2']);
  });
});

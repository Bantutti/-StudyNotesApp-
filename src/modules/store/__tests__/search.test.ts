import { SAMPLE_NOTE } from '@/core';

import { MARK_OPEN, parseSearchQuery, splitSnippet } from '../index';
import { doc, makeStore, para } from './helpers';

const PACK = 'pastel-highlight';

describe('parseSearchQuery', () => {
  it('keeps only letters and digits as quoted prefix terms', () => {
    expect(parseSearchQuery('osmo')).toBe('"osmo"*');
    expect(parseSearchQuery('  cell   wall ')).toBe('"cell"* "wall"*');
    expect(parseSearchQuery('NEAR(a b) OR title:x "quote" * -minus ^caret')).toBe(
      '"NEAR"* "a"* "b"* "OR"* "title"* "x"* "quote"* "minus"*',
    );
    expect(parseSearchQuery('***')).toBeNull();
    expect(parseSearchQuery('')).toBeNull();
  });

  it('caps the number and length of terms', () => {
    const q = parseSearchQuery(`${'a'.repeat(100)} b c d e f g h i j`)!;
    expect(q.split(' ')).toHaveLength(8);
    expect(q.startsWith(`"${'a'.repeat(40)}"*`)).toBe(true);
  });

  it('splits snippets into plain parts', () => {
    expect(splitSnippet(`the ${MARK_OPEN}osmosis\uE001 rule`)).toEqual([
      { text: 'the ', match: false },
      { text: 'osmosis', match: true },
      { text: ' rule', match: false },
    ]);
  });
});

describe('search', () => {
  it('finds words by prefix, ignoring case and accents, and points at the block', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK, title: 'Osmosis & Diffusion', document: SAMPLE_NOTE });
    const hits = await store.search('hyperton');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.noteId).toBe(n.id);
    expect(hits[0]?.matches.map((m) => m.blockId)).toEqual(expect.arrayContaining(['b_sample000000012']));
    expect(await store.search('TUBIG')).toHaveLength(1); // Taglish line
    const accented = await store.notes.create({ stylePackId: PACK, document: doc(para('Ósmosis en la célula')) });
    expect((await store.search('celula')).map((h) => h.noteId)).toEqual([accented.id]);
  });

  it('indexes definition terms and titles as their own kinds', async () => {
    const { store } = await makeStore();
    await store.notes.create({ stylePackId: PACK, title: 'Membranes', document: SAMPLE_NOTE });
    const term = (await store.search('osmosis'))[0]!.matches.map((m) => m.kind);
    expect(term).toEqual(expect.arrayContaining(['term']));
    expect((await store.search('membranes'))[0]?.matches[0]?.kind).toBe('title');
  });

  it('ranks a title match above a passing mention', async () => {
    const { store, clock } = await makeStore();
    const titled = await store.notes.create({ stylePackId: PACK, title: 'Photosynthesis', document: doc(para('light reactions')) });
    clock.advance(10);
    await store.notes.create({ stylePackId: PACK, title: 'Week 3', document: doc(para('we mentioned photosynthesis once among many other words here')) });
    expect((await store.search('photosynthesis'))[0]?.noteId).toBe(titled.id);
  });

  it('updates the index on save and drops old text', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK, document: doc(para('mitochondria')) });
    await store.notes.save(n.id, { document: doc(para('ribosome')) });
    expect(await store.search('mitochondria')).toHaveLength(0);
    expect(await store.search('ribosome')).toHaveLength(1);
    await store.notes.save(n.id, { title: 'Organelles' });
    expect(await store.search('organelles')).toHaveLength(1);
    expect(await store.search('ribosome')).toHaveLength(1);
  });

  it('never throws on hostile input and cannot fake highlight markers', async () => {
    const { store } = await makeStore();
    await store.notes.create({ stylePackId: PACK, document: doc(para(`fake ${MARK_OPEN}highlight\uE001 here`)) });
    for (const q of ['"', 'NEAR(', ')))', 'a OR', '*', 'title:', "'; DROP TABLE notes; --", '\u0000']) {
      await expect(store.search(q)).resolves.toBeInstanceOf(Array);
    }
    const parts = (await store.search('fake'))[0]!.matches[0]!.snippet;
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['fake']);
    expect(await store.notes.list({ scope: 'all' })).toHaveLength(1); // still there
  });
});

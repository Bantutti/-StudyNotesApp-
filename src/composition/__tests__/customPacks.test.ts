/**
 * P5 M5: custom packs end to end (store <-> registry <-> use cases), and the
 * Match a look flow with fake image ports.
 */
import { createLogger, createSeqIdGenerator, memorySink, SAMPLE_NOTE } from '@/core';
import { chipOptions, runMatch, type ImageIntakePorts } from '@/modules/lookmatch';
import { openStore } from '@/modules/store';
import { createPackRegistry, DEFAULT_PACK_ID, validatePack, type StylePack } from '@/modules/stylepacks';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { cleanPackName, deleteCustomPack, loadCustomPacks, MAX_CUSTOM_PACKS, renameCustomPack, saveCustomPack } from '../customPacks';
import { applyPackToNote, setSubjectPack } from '../useCases';
// Test-only helpers from lookmatch (a SYNTHETIC page and a metadata-laden JPEG fixture).
import { BASELINE_WITH_METADATA } from '../../modules/lookmatch/__tests__/fixtures/jpegs';
import { synthPage } from '../../modules/lookmatch/__tests__/helpers/synthPage';

async function setup() {
  const driver = nodeSqliteDriver();
  const logger = createLogger({ sink: memorySink(200), minLevel: 'debug' });
  const store = await openStore(driver, { ids: createSeqIdGenerator(), logger });
  return { store, driver, packs: createPackRegistry(), logger };
}

const ID = 'ref-abcdefghijklmnopqrst';
function customPack(id = ID, name = 'Blue cottage'): StylePack {
  const base = createPackRegistry().get('cottagecore')!;
  return { ...JSON.parse(JSON.stringify(base)), id, name, meta: { ...base.meta, tier: 'extra' } } as StylePack;
}

describe('custom packs: save, load, apply, rename, delete', () => {
  it('saves a pack, makes it available to notes and subjects, and survives a reload', async () => {
    const { store, packs } = await setup();
    await saveCustomPack(store, packs, customPack());
    expect(packs.get(ID)?.name).toBe('Blue cottage');
    const s = await store.subjects.create({ name: 'Bio', color: '#4F7CF7' });
    const n = await store.notes.create({ subject: s.id, document: SAMPLE_NOTE, stylePackId: DEFAULT_PACK_ID });
    expect(await applyPackToNote(store, n.id, ID)).toBe(true);
    await setSubjectPack(store, s.id, ID);
    // A fresh registry (app restart) gets it back from the database.
    const again = createPackRegistry();
    expect(await loadCustomPacks(store, again)).toEqual({ accepted: 1, rejected: 0 });
    expect(again.getOrDefault(ID).name).toBe('Blue cottage');
  });

  it('re-validates on every load: tampered or unreadable rows are skipped and counted, never rendered', async () => {
    const { store, packs, driver } = await setup();
    await saveCustomPack(store, packs, customPack());
    const bad = { ...customPack('ref-bbbbbbbbbbbbbbbbbbbb'), palette: { ...customPack().palette, ink: '#FBF6E9' } }; // ink = paper
    driver.raw.exec(`INSERT INTO stylePacks (id, created, updated, version, definition) VALUES ('ref-bbbbbbbbbbbbbbbbbbbb', 1, 1, 1, '${JSON.stringify(bad)}')`);
    driver.raw.exec(`INSERT INTO stylePacks (id, created, updated, version, definition) VALUES ('ref-cccccccccccccccccccc', 1, 1, 1, '{not json')`);
    const fresh = createPackRegistry();
    expect(await loadCustomPacks(store, fresh)).toEqual({ accepted: 1, rejected: 2 });
    expect(fresh.get('ref-bbbbbbbbbbbbbbbbbbbb')).toBeUndefined();
    // Applying an id that isn't a live pack is refused.
    const n = await store.notes.create({ stylePackId: DEFAULT_PACK_ID });
    await expect(applyPackToNote(store, n.id, 'ref-zzzzzzzzzzzzzzzzzzzz')).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('a row whose pack names a different id is skipped (P5-S1), and at most MAX_CUSTOM_PACKS load (P5-S2)', async () => {
    const { store, packs, driver } = await setup();
    await saveCustomPack(store, packs, customPack());
    // A tampered row "ref-ddd..." whose definition claims to be ID: must not replace ID.
    const evil = { ...customPack(ID, 'Hijacked') };
    driver.raw.exec(`INSERT INTO stylePacks (id, created, updated, version, definition) VALUES ('ref-dddddddddddddddddddd', 9e12, 9e12, 1, '${JSON.stringify(evil)}')`);
    const fresh = createPackRegistry();
    expect(await loadCustomPacks(store, fresh)).toEqual({ accepted: 1, rejected: 1 });
    expect(fresh.get(ID)?.name).toBe('Blue cottage');
    for (let i = 0; i < MAX_CUSTOM_PACKS + 5; i++) {
      const id = `ref-${String(i).padStart(4, 'a').replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]!)}${'e'.repeat(16)}`;
      driver.raw.exec(`INSERT INTO stylePacks (id, created, updated, version, definition) VALUES ('${id}', 1, ${i + 2}, 1, '${JSON.stringify(customPack(id, `P${i}`))}')`);
    }
    const many = createPackRegistry();
    const r = await loadCustomPacks(store, many);
    expect(r.accepted + r.rejected).toBe(MAX_CUSTOM_PACKS);
    expect(many.custom().length).toBeLessThanOrEqual(MAX_CUSTOM_PACKS);
  });

  it('refuses to save an invalid pack or a built-in id', async () => {
    const { store, packs } = await setup();
    await expect(saveCustomPack(store, packs, { ...customPack(), id: 'pastel-highlight' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(saveCustomPack(store, packs, { ...customPack(), name: '<b>x</b>' })).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await store.stylePacks.list()).toEqual([]);
  });

  it('renames (version + 1) and deletes (notes back to the default, default look reset)', async () => {
    const { store, packs } = await setup();
    await saveCustomPack(store, packs, customPack());
    await renameCustomPack(store, packs, ID, '  Rainy   day\u202E ');
    expect(packs.get(ID)?.name).toBe('Rainy day');
    expect((await store.stylePacks.get(ID))?.version).toBe(2);
    const n = await store.notes.create({ stylePackId: DEFAULT_PACK_ID });
    await applyPackToNote(store, n.id, ID);
    await store.settings.update({ defaultPack: ID });
    expect(await deleteCustomPack(store, packs, ID)).toBe(1);
    expect((await store.notes.get(n.id))?.stylePackId).toBe(DEFAULT_PACK_ID);
    expect((await store.settings.get()).defaultPack).toBe(DEFAULT_PACK_ID);
    expect(packs.get(ID)).toBeUndefined();
    await expect(deleteCustomPack(store, packs, 'pastel-highlight')).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('cleans names: spoofing characters removed, length capped, markup and URLs refused', () => {
    expect(cleanPackName('  My\u200b  look ')).toBe('My look');
    expect(cleanPackName('')).toBe('My look');
    expect(cleanPackName('x'.repeat(80))).toHaveLength(40);
    for (const bad of ['<script>', 'a{b}', 'see https://evil.example', 'a;b', 'url(x)', 'javascript:alert(1)']) {
      expect(() => cleanPackName(bad)).toThrow();
    }
  });
});

describe('runMatch (the flow without UI)', () => {
  const lined = synthPage({ paper: '#FFF7E8', line: '#E3D9C2', type: 'lined', period: 12, ink: '#3B2F2F', accent: '#2D7D9A', noise: 2 });
  const ports = (): ImageIntakePorts & { removed: string[] } => {
    const removed: string[] = [];
    return {
      removed,
      encodeCopy: async (_uri, _s, longSide) => ({ uri: `file:///cache/m${longSide}.jpg`, width: 288, height: 384, base64: BASELINE_WITH_METADATA }),
      decodeJpeg: () => lined,
      removeTemp: async (u) => {
        removed.push(u);
      },
    };
  };
  const picked = [{ uri: 'file:///cache/ImagePicker/a.jpg', width: 3000, height: 4000, fileSize: 3_000_000, mimeType: 'image/jpeg', type: 'image' }];
  let n = 0;
  const randomBytes = (len: number) => Uint8Array.from({ length: len }, () => (n += 37) & 255);

  it('turns photos into a validated custom pack, deletes every temp file, and keeps no vision copies unless asked', async () => {
    const p = ports();
    const stages: string[] = [];
    const r = await runMatch({ picked, ports: p, builtIns: createPackRegistry().builtIn(), randomBytes, name: 'My look 1', keepVisionCopies: false, onProgress: (s) => stages.push(s.stage) });
    expect(validatePack(r.matched).ok).toBe(true);
    expect(r.matched.id).toMatch(/^ref-[a-z2-7]{20}$/);
    expect(r.matched.paper.type).toBe('lined');
    expect(r.ranked).toHaveLength(13);
    expect(r.visionImages).toEqual([]);
    expect(stages[0]).toBe('cleaning');
    expect(stages[stages.length - 1]).toBe('done');
    expect(p.removed).toEqual(expect.arrayContaining(['file:///cache/m384.jpg', 'file:///cache/ImagePicker/a.jpg']));
  });

  it('chip options are schema values from the photo and the nearest pack', async () => {
    const r = await runMatch({ picked, ports: ports(), builtIns: createPackRegistry().builtIn(), randomBytes, name: 'x', keepVisionCopies: false });
    const o = chipOptions(r.analysis, r.ranked[0]!.pack, createPackRegistry().builtIn());
    expect(o.paperColors[0]).toEqual({ hex: r.analysis.paper.color, source: 'photo' });
    for (const c of [...o.paperColors, ...o.inkColors, ...o.accentColors]) expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(new Set(o.fonts.map((f) => `${f.fonts.header}|${f.fonts.body}`)).size).toBe(o.fonts.length);
    expect(o.fonts[0]!.fromPack).toBe(r.ranked[0]!.pack.id);
    expect(o.paperTypes).toEqual(['lined', 'grid', 'dotted', 'plain']);
  });
});

/**
 * §5 gate file: fail-closed loading, per-provider versioned consent, the age
 * answer without the year, re-check after one year, and forget().
 */
import { PROVIDER_CATALOG } from '@/modules/ai';

import { createGateStore, GATE_FILE_MAX_CHARS } from '../gate/gateStore';
import { memoryFile, spyLogger } from './helpers';

const NOV1 = new Date(2026, 10, 1, 10, 0).getTime();

function setup(initial: string | null = null) {
  let t = NOV1;
  const file = memoryFile(initial);
  const log = spyLogger();
  const gate = createGateStore({ file, logger: log.logger, now: () => t });
  return { gate, file, log, advance: (ms: number) => void (t += ms), setNow: (v: number) => void (t = v) };
}

describe('gate store', () => {
  it('starts with no age and no consent', async () => {
    const { gate } = setup();
    expect(await gate.isAdultConfirmed()).toBe(false);
    expect(await gate.hasConsent('groq', 1, 'text')).toBe(false);
    expect(await gate.ageStatus()).toEqual({ kind: 'unknown' });
  });

  it.each([
    ['not json', '{oops'],
    ['wrong shape', JSON.stringify({ v: 1, age: { adult: 'yes' } })],
    ['unknown field', JSON.stringify({ v: 1, age: { adult: true, checkedAt: 1, year: 2000 }, consents: {}, defaultProvider: null, fakeMode: false })],
    ['future version', JSON.stringify({ v: 3, age: { adult: true, checkedAt: 1 }, consents: {}, defaultProvider: null, fakeMode: false })],
    ['too big', 'x'.repeat(GATE_FILE_MAX_CHARS + 1)],
  ])('fails closed on a %s file', async (_name, raw) => {
    const { gate } = setup(raw);
    expect(await gate.isAdultConfirmed()).toBe(false);
    expect(await gate.hasConsent('groq', 1, 'text')).toBe(false);
  });

  it('stores only the age RESULT and the date checked', async () => {
    const { gate, file } = setup();
    await gate.recordAge(true);
    expect(await gate.isAdultConfirmed()).toBe(true);
    const saved = JSON.parse(file.content as string);
    expect(saved.age).toEqual({ adult: true, checkedAt: NOV1 });
    expect(file.content).not.toMatch(/year|birth|19\d\d|20[01]\d/i);
  });

  it('consent counts only for that provider and that version', async () => {
    const { gate } = setup();
    const v = PROVIDER_CATALOG.groq.consent.version;
    await gate.giveConsent('groq', v, 'text');
    expect(await gate.hasConsent('groq', v, 'text')).toBe(true);
    expect(await gate.hasConsent('mistral', PROVIDER_CATALOG.mistral.consent.version, 'text')).toBe(false);
    // A bumped catalog version asks again (old "yes" stops counting).
    expect(await gate.hasConsent('groq', v + 1, 'text')).toBe(false);
    await gate.withdrawConsent('groq', 'text');
    expect(await gate.hasConsent('groq', v, 'text')).toBe(false);
  });

  it('rejects a nonsense consent version', async () => {
    const { gate } = setup();
    await expect(gate.giveConsent('groq', 0, 'text')).rejects.toThrow('bad_consent_version');
  });

  it('a minor answer sticks; re-check only after a full year (§1.4)', async () => {
    const { gate, setNow } = setup();
    await gate.recordAge(false);
    expect(await gate.ageStatus()).toEqual({ kind: 'minor', checkedAt: NOV1, recheckAvailable: false });
    expect(await gate.clearAgeForRecheck()).toBe(false);
    setNow(new Date(2027, 9, 31, 10, 0).getTime());
    expect((await gate.ageStatus()).kind).toBe('minor');
    expect(await gate.clearAgeForRecheck()).toBe(false);
    setNow(new Date(2027, 10, 1, 10, 0).getTime());
    expect(await gate.ageStatus()).toMatchObject({ kind: 'minor', recheckAvailable: true });
    expect(await gate.clearAgeForRecheck()).toBe(true);
    expect(await gate.ageStatus()).toEqual({ kind: 'unknown' });
  });

  it('an adult answer cannot be cleared through the re-check path', async () => {
    const { gate, setNow } = setup();
    await gate.recordAge(true);
    setNow(new Date(2030, 0, 1).getTime());
    expect(await gate.clearAgeForRecheck()).toBe(false);
    expect(await gate.isAdultConfirmed()).toBe(true);
  });

  it('serialises quick writes (no lost update)', async () => {
    const { gate } = setup();
    await Promise.all([gate.giveConsent('groq', 1, 'text'), gate.giveConsent('mistral', 1, 'text'), gate.recordAge(true), gate.setDefaultProvider('mistral')]);
    expect(await gate.hasConsent('groq', 1, 'text')).toBe(true);
    expect(await gate.hasConsent('mistral', 1, 'text')).toBe(true);
    expect(await gate.isAdultConfirmed()).toBe(true);
    expect(await gate.defaultProvider()).toBe('mistral');
  });

  it('a failed write keeps the previous state', async () => {
    const { gate, file } = setup();
    file.write = async () => {
      throw new Error('disk full');
    };
    await expect(gate.recordAge(true)).rejects.toThrow();
    expect(await gate.isAdultConfirmed()).toBe(false);
  });

  it('reloads from the file after forget() (Delete all data)', async () => {
    const { gate, file } = setup();
    await gate.recordAge(true);
    await gate.giveConsent('groq', 1, 'text');
    file.content = null; // the ai folder was deleted
    expect(await gate.isAdultConfirmed()).toBe(true); // still cached
    gate.forget();
    expect(await gate.isAdultConfirmed()).toBe(false);
    expect(await gate.hasConsent('groq', 1, 'text')).toBe(false);
  });

  it('logs event names only, never answers', async () => {
    const { gate, log } = setup();
    await gate.recordAge(false);
    await gate.giveConsent('groq', 1, 'text');
    const dump = log.dump();
    expect(dump).toContain('age_recorded');
    expect(dump).not.toMatch(/"adult"|false|true/);
  });
});

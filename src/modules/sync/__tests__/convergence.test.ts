/**
 * Seeded random runs (no new dependency): two or three devices make random
 * edits, deletes and creates, go on and offline, lose acks and sync in any
 * order. At the end, after every conflict is resolved, all devices and the
 * cloud must hold exactly the same data, and no conflict may be left over.
 * A failing seed is printed so the run can be replayed.
 */
import { UNDO_WINDOW_MS } from '@/modules/store';

import type { ConflictChoice } from '../conflicts';
import { PACK, setup, settle, snapshot, type Device } from './harness';

/** mulberry32: tiny deterministic PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function liveNotes(d: Device) {
  return d.store.notes.list({ scope: 'all' });
}

async function runSeed(seed: number, devices = 2, steps = 60) {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const env = await setup(devices);
  const all = env.devices;
  for (const d of all) await d.enable();
  let counter = 0;

  for (let i = 0; i < steps; i++) {
    const d = pick(all);
    const op = r();
    env.clock.advance(Math.floor(r() * 3000));
    const notes = await liveNotes(d);
    if (op < 0.25 || notes.length === 0) {
      await d.store.notes.create({ stylePackId: PACK, title: `${d.name}${counter++}` });
    } else if (op < 0.6) {
      const n = pick(notes);
      await d.store.notes.save(n.id, { title: `${d.name} edit ${counter++}` });
    } else if (op < 0.68) {
      await d.store.notes.remove([pick(notes).id]);
    } else if (op < 0.76) {
      d.remote.setOnline(r() < 0.5);
    } else if (op < 0.8) {
      d.remote.loseNextAck();
    } else if (op < 0.85) {
      env.clock.advance(UNDO_WINDOW_MS + 1);
    } else {
      await d.sync();
    }
  }

  // Everyone back online; resolve every conflict with a random choice until quiet.
  for (const d of all) d.remote.setOnline(true);
  env.clock.advance(UNDO_WINDOW_MS + 1);
  for (let round = 0; round < 8; round++) {
    await settle(all);
    let open = 0;
    for (const d of all) {
      for (const c of await d.store.sync.listConflicts()) {
        open += 1;
        const choices: ConflictChoice[] = c.kind === 'edit_edit' ? ['mine', 'other', 'both'] : ['mine', 'other'];
        await d.engine.resolve(c.tbl, c.id, pick(choices));
      }
    }
    if (open === 0) break;
  }
  await settle(all);
  return env;
}

const SEEDS = Array.from({ length: Number(process.env.SYNC_SEEDS ?? 12) }, (_, i) => i + 1);

describe('random two-device runs converge', () => {
  it.each(SEEDS)('seed %i', async (seed) => {
    const env = await runSeed(seed);
    const [first, ...rest] = env.devices;
    for (const d of env.devices) {
      expect({ seed, conflicts: await d.store.sync.countConflicts() }).toEqual({ seed, conflicts: 0 });
      expect({ seed, pending: (await d.store.sync.listOutbox()).length }).toEqual({ seed, pending: 0 });
    }
    for (const d of rest) expect({ seed, data: snapshot(d, ['notes']) }).toEqual({ seed, data: snapshot(first!, ['notes']) });
    // And the cloud agrees with the devices (titles of live notes).
    const cloudLive = env.cloud.all('notes').filter((n) => n.data.deleted === false).map((n) => [n.id, n.data.title]).sort();
    const devLive = (await liveNotes(first!)).map((n) => [n.id, n.title]).sort();
    expect({ seed, live: devLive }).toEqual({ seed, live: cloudLive });
  });

  it('three devices converge too', async () => {
    const env = await runSeed(99, 3, 90);
    const [first, ...rest] = env.devices;
    for (const d of rest) expect(snapshot(d, ['notes'])).toEqual(snapshot(first!, ['notes']));
  });
});

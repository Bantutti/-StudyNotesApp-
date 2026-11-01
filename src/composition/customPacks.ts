/**
 * Custom style packs ("Match a look", P5 M5): the use cases between the
 * store (rows), the pack registry (validated packs) and the screens.
 *
 * Trust boundary: a stored definition may come from sync (another device,
 * or a tampered cloud doc), so EVERY load re-validates it with stylepacks'
 * validatePack through registry.setCustom. Invalid rows are skipped and
 * counted, never rendered.
 */
import { AppError, type Logger } from '@/core';
import type { Store } from '@/modules/store';
import { DEFAULT_PACK_ID, isCustomPackId, MAX_STR, validatePack, type PackRegistry, type StylePack } from '@/modules/stylepacks';

/** Longest custom pack name (the schema allows 160; 40 fits the picker card). */
export const PACK_NAME_MAX = 40;
/** Words and characters the pack schema refuses in any text field (stylepacks schema UNSAFE). */
const UNSAFE_NAME = /[<>{};]|url\(|https?:|javascript:|@import/i;

/**
 * A safe display name: control and bidi characters removed, spaces
 * collapsed, at most PACK_NAME_MAX characters. Names the schema would refuse
 * (markup, CSS, URLs) are rejected with a plain message instead of being
 * silently rewritten.
 */
export function cleanPackName(input: string, fallback = 'My look'): string {
  // Removes C0/C1 control characters, zero-width characters and bidi overrides (spoofing).
  const s = input.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
  if (UNSAFE_NAME.test(s)) throw new AppError('validation_failed', 'Use letters, numbers and simple punctuation for the name.');
  const name = (s || fallback).slice(0, Math.min(PACK_NAME_MAX, MAX_STR)).trim();
  return name || fallback;
}

/** Reads every live custom pack from the store into the registry (validated). */
export async function loadCustomPacks(store: Store, packs: PackRegistry, logger?: Logger): Promise<{ accepted: number; rejected: number }> {
  const rows = await store.stylePacks.list();
  const defs: unknown[] = [];
  let unreadable = 0;
  for (const r of rows) {
    try {
      defs.push(JSON.parse(r.definition));
    } catch {
      unreadable++;
    }
  }
  const res = packs.setCustom(defs);
  const out = { accepted: res.accepted, rejected: res.rejected + unreadable };
  if (out.rejected) logger?.warn('packs.custom_rejected', { count: out.rejected }); // counts only, never content
  return out;
}

/** Saves a matched pack (validated again here) and refreshes the registry. */
export async function saveCustomPack(store: Store, packs: PackRegistry, pack: StylePack): Promise<StylePack> {
  const report = validatePack(pack);
  if (!report.ok || !report.pack || !isCustomPackId(report.pack.id)) throw new AppError('validation_failed', 'That look could not be saved.');
  await store.stylePacks.save({ id: report.pack.id, definition: report.pack, createdFromReference: true });
  await loadCustomPacks(store, packs);
  return report.pack;
}

async function liveCustom(store: Store, id: string): Promise<StylePack> {
  if (!isCustomPackId(id)) throw new AppError('not_found', 'That look no longer exists.');
  const row = await store.stylePacks.get(id);
  if (!row || row.deleted) throw new AppError('not_found', 'That look no longer exists.');
  let def: unknown;
  try {
    def = JSON.parse(row.definition);
  } catch {
    def = null;
  }
  const report = validatePack(def);
  if (!report.ok || !report.pack) throw new AppError('validation_failed', 'That look is damaged. Delete it and match it again.');
  return report.pack;
}

export async function renameCustomPack(store: Store, packs: PackRegistry, id: string, name: string): Promise<StylePack> {
  const cur = await liveCustom(store, id);
  return saveCustomPack(store, packs, { ...cur, name: cleanPackName(name, cur.name) });
}

/**
 * Deletes a custom pack. Its notes and subjects move to the default pack
 * (store, one transaction); the user's default look is reset if it was this
 * pack. Returns how many notes changed look.
 */
export async function deleteCustomPack(store: Store, packs: PackRegistry, id: string): Promise<number> {
  if (!isCustomPackId(id)) throw new AppError('validation_failed', 'Built-in looks cannot be deleted.');
  const moved = await store.stylePacks.remove(id, DEFAULT_PACK_ID);
  const settings = await store.settings.get();
  if (settings.defaultPack === id) await store.settings.update({ defaultPack: DEFAULT_PACK_ID });
  await loadCustomPacks(store, packs);
  return moved;
}

/** True when `id` is a built-in pack or a live custom pack (used before applying a look). */
export async function packIsAvailable(store: Store, id: string, isBuiltIn: (id: string) => boolean): Promise<boolean> {
  if (isBuiltIn(id)) return true;
  if (!isCustomPackId(id)) return false;
  const row = await store.stylePacks.get(id);
  return !!row && !row.deleted;
}

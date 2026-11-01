/**
 * Style packs the app can render: the 13 bundled packs plus the student's
 * own custom packs (P5 "Match a look").
 *
 * Every pack is validated when it enters the registry (validatePack: schema
 * + contrast). An invalid bundled pack is a build bug and is excluded (and
 * reported); an invalid custom pack (for example tampered sync data) is
 * dropped the same way, so nothing unvalidated ever reaches the style engine.
 * P2a MERGE_NOTES requires exactly this "validate on load" for synced packs.
 */
import blackoutGel from './packs/blackout-gel.json';
import chalkboard from './packs/chalkboard.json';
import clearRead from './packs/clear-read.json';
import colorCode from './packs/color-code.json';
import coquette from './packs/coquette.json';
import cottagecore from './packs/cottagecore.json';
import darkAcademia from './packs/dark-academia.json';
import kawaiiPop from './packs/kawaii-pop.json';
import lightAcademia from './packs/light-academia.json';
import oceanLines from './packs/ocean-lines.json';
import pastelHighlight from './packs/pastel-highlight.json';
import peachGrid from './packs/peach-grid.json';
import seoulMinimal from './packs/seoul-minimal.json';
import type { StylePack } from './schema';
import { validatePack } from './validate';

export const DEFAULT_PACK_ID = 'pastel-highlight';

/** Packs the P0 spikes switch between (one light, one dark). */
export const P0_PACK_IDS = ['pastel-highlight', 'dark-academia'] as const;

/** Packs offered in the P1 app (P1 decision Q1). Kept for P1 code paths; P5 offers V1_PACK_IDS. */
export const P1_PACK_IDS = ['pastel-highlight', 'clear-read'] as const;

/**
 * Packs offered in v1 (P5 decision Q1 = A, Rey's Nov 1 set): the 10 launch
 * packs in the order of the v3 set, then the 3 extras. Pastel Highlight
 * stays first because it is the default.
 */
export const V1_PACK_IDS = [
  'pastel-highlight', 'color-code', 'seoul-minimal', 'light-academia', 'dark-academia',
  'blackout-gel', 'cottagecore', 'coquette', 'kawaii-pop', 'clear-read',
  'ocean-lines', 'peach-grid', 'chalkboard',
] as const;
export type BuiltInPackId = (typeof V1_PACK_IDS)[number];

/**
 * Custom pack ids: "ref-" + 20 lowercase base32 characters (100 random bits).
 * This fits both the pack schema id rule (lowercase, 2-41 chars) and P2a's
 * entity id rule (16-64 chars of [A-Za-z0-9_-], at least 80 random bits),
 * so one id names the pack, its local row and its cloud document.
 */
export const CUSTOM_PACK_ID = /^ref-[a-z2-7]{20}$/;

export const isBuiltInPackId = (id: string): id is BuiltInPackId => (V1_PACK_IDS as readonly string[]).includes(id);
export const isCustomPackId = (id: string): boolean => CUSTOM_PACK_ID.test(id);

const RAW: readonly unknown[] = [
  pastelHighlight, colorCode, seoulMinimal, lightAcademia, darkAcademia, blackoutGel,
  cottagecore, coquette, kawaiiPop, clearRead, oceanLines, peachGrid, chalkboard,
];

export interface PackRegistry {
  get(id: string): StylePack | undefined;
  getOrDefault(id: string): StylePack;
  /** Every pack, built-in first (v1 order), then custom packs by name. */
  list(): StylePack[];
  builtIn(): StylePack[];
  custom(): StylePack[];
  /**
   * Replaces the custom packs (from the local stylePacks table). Each entry
   * is validated; entries whose id is not a custom id, or that fail
   * validatePack, are dropped and counted in the return value.
   */
  setCustom(raw: readonly unknown[]): { accepted: number; rejected: number };
  /** Bumps on every setCustom, for React's useSyncExternalStore. */
  revision(): number;
  subscribe(listener: () => void): () => void;
  rejected: string[];
}

export function createPackRegistry(raw: readonly unknown[] = RAW): PackRegistry {
  const builtIns = new Map<string, StylePack>();
  const rejected: string[] = [];
  raw.forEach((r, i) => {
    const report = validatePack(r);
    if (report.ok && report.pack) builtIns.set(report.pack.id, report.pack);
    else rejected.push(`pack #${i}`);
  });
  let customs = new Map<string, StylePack>();
  let rev = 0;
  const listeners = new Set<() => void>();

  const ordered = (): StylePack[] => {
    const byOrder = V1_PACK_IDS.map((id) => builtIns.get(id)).filter((p): p is StylePack => !!p);
    // Built-ins not in V1_PACK_IDS (only possible in tests with custom raw input) come after.
    const others = [...builtIns.values()].filter((p) => !isBuiltInPackId(p.id));
    return [...byOrder, ...others];
  };
  const customList = () => [...customs.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    get: (id) => builtIns.get(id) ?? customs.get(id),
    getOrDefault(id) {
      const p = builtIns.get(id) ?? customs.get(id) ?? builtIns.get(DEFAULT_PACK_ID);
      if (!p) throw new Error('default_pack_missing');
      return p;
    },
    list: () => [...ordered(), ...customList()],
    builtIn: ordered,
    custom: customList,
    setCustom(input) {
      const next = new Map<string, StylePack>();
      let bad = 0;
      for (const r of input) {
        const report = validatePack(r);
        // A custom pack may never shadow a built-in id, and must use the custom id shape.
        if (report.ok && report.pack && isCustomPackId(report.pack.id)) next.set(report.pack.id, report.pack);
        else bad++;
      }
      customs = next;
      rev++;
      listeners.forEach((l) => l());
      return { accepted: next.size, rejected: bad };
    },
    revision: () => rev,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    rejected,
  };
}

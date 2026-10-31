/**
 * Bundled style packs. Every pack is validated when the registry is built;
 * an invalid bundled pack is a build bug and is excluded (and reported).
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

const RAW: readonly unknown[] = [
  pastelHighlight, colorCode, seoulMinimal, lightAcademia, darkAcademia, blackoutGel,
  cottagecore, coquette, kawaiiPop, clearRead, oceanLines, peachGrid, chalkboard,
];

export interface PackRegistry {
  get(id: string): StylePack | undefined;
  getOrDefault(id: string): StylePack;
  list(): StylePack[];
  rejected: string[];
}

export function createPackRegistry(raw: readonly unknown[] = RAW): PackRegistry {
  const packs = new Map<string, StylePack>();
  const rejected: string[] = [];
  raw.forEach((r, i) => {
    const report = validatePack(r);
    if (report.ok && report.pack) packs.set(report.pack.id, report.pack);
    else rejected.push(`pack #${i}`);
  });
  return {
    get: (id) => packs.get(id),
    getOrDefault(id) {
      const p = packs.get(id) ?? packs.get(DEFAULT_PACK_ID);
      if (!p) throw new Error('default_pack_missing');
      return p;
    },
    list: () => [...packs.values()],
    rejected,
  };
}

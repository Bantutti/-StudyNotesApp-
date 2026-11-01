/**
 * Plain-text preview of two versions for the Conflict resolver (Q-plan §5):
 * per block id, whether it is the same, changed, only here or only there.
 * Reads rows as stored (JSON text); bad JSON shows as empty, never crashes.
 */
import { extractTextBlocks, parseNoteDocJson } from '@/core';
import type { SqlRow } from '@/modules/store';

export type PreviewMark = 'same' | 'changed' | 'added' | 'removed';
export interface PreviewLine {
  key: string;
  text: string;
  mark: PreviewMark;
}

function linesOf(row: SqlRow | null): { title: string; lines: { id: string; text: string }[]; deleted: boolean } {
  if (!row) return { title: '', lines: [], deleted: true };
  const deleted = row.deleted === 1;
  if ('document' in row) {
    const d = parseNoteDocJson(String(row.document ?? ''));
    const blocks = d.ok ? extractTextBlocks(d.value) : [];
    const seen = new Map<string, number>();
    return {
      title: String(row.title ?? ''),
      deleted,
      lines: blocks.map((b, i) => {
        const base = b.blockId ?? `#${i}`;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return { id: `${base}:${n}`, text: b.text };
      }),
    };
  }
  // Cards and recordings: field by field.
  const fields = ['front', 'back', 'language', 'duration'].filter((k) => k in row);
  return { title: '', deleted, lines: fields.map((k) => ({ id: k, text: `${k}: ${String(row[k] ?? '')}` })) };
}

export function previewPair(mine: SqlRow | null, theirs: SqlRow) {
  const a = linesOf(mine);
  const b = linesOf(theirs);
  const bMap = new Map(b.lines.map((l) => [l.id, l.text]));
  const aMap = new Map(a.lines.map((l) => [l.id, l.text]));
  const mark = (id: string, text: string, other: Map<string, string>, onlyMark: PreviewMark): PreviewMark =>
    !other.has(id) ? onlyMark : other.get(id) === text ? 'same' : 'changed';
  return {
    mine: { title: a.title, deleted: a.deleted, lines: a.lines.map((l): PreviewLine => ({ key: l.id, text: l.text, mark: mark(l.id, l.text, bMap, 'added') })) },
    theirs: { title: b.title, deleted: b.deleted, lines: b.lines.map((l): PreviewLine => ({ key: l.id, text: l.text, mark: mark(l.id, l.text, aMap, 'removed') })) },
  };
}

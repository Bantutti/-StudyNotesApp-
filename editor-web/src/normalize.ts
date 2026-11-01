/**
 * Last-mile fixes before a document leaves the editor, so an edit is never
 * silently rejected by the app's schema (which would lose it):
 *  - ragged table rows (possible after pasting HTML tables) are padded
 *    with empty cells;
 *  - tables over the limits (12 columns, 200 rows) become plain lines, one
 *    per cell, so no text is lost.
 * Pure function on TipTap JSON.
 */
import { DOC_LIMITS } from '../../src/core/document/schema';

type J = { type?: string; attrs?: Record<string, unknown>; content?: J[]; text?: string; marks?: unknown[] };

const emptyCell = (type: string): J => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph' }] });

function fixTable(t: J): J[] {
  const rows = (t.content ?? []).filter((r) => r.type === 'tableRow');
  const width = Math.max(0, ...rows.map((r) => (r.content ?? []).length));
  if (rows.length === 0 || width === 0) return [];
  if (width > DOC_LIMITS.maxTableCols || rows.length > DOC_LIMITS.maxTableRows) {
    // Too big for a simple table: keep the text as lines.
    const lines: J[] = [];
    for (const r of rows) for (const c of r.content ?? []) for (const p of c.content ?? []) if (p.type === 'paragraph') lines.push(p);
    return lines.length ? lines : [{ type: 'paragraph' }];
  }
  const padded = rows.map((r) => {
    const cells = [...(r.content ?? [])];
    const kind = cells[cells.length - 1]?.type === 'tableHeader' ? 'tableHeader' : 'tableCell';
    while (cells.length < width) cells.push(emptyCell(kind));
    return { ...r, content: cells };
  });
  return [{ ...t, content: padded }];
}

export function normalizeDoc<T>(doc: T): T {
  const walk = (nodes: J[] | undefined): J[] | undefined => {
    if (!nodes) return nodes;
    const out: J[] = [];
    for (const n of nodes) {
      if (n.type === 'table') out.push(...fixTable({ ...n, content: walk(n.content) }));
      else out.push(n.content ? { ...n, content: walk(n.content) } : n);
    }
    return out;
  };
  const d = doc as unknown as J;
  return { ...d, content: walk(d.content) ?? [] } as unknown as T;
}

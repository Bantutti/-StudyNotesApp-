/**
 * Full-text search over notes (FTS5, one row per text block: decision Q10).
 *
 * Index: searchMap(rowid, noteId, blockId, kind) + search(text) share rowids.
 * Results open the note at the matching block.
 *
 * Safety:
 * - User input never reaches FTS5 syntax. parseSearchQuery() keeps only
 *   letters and digits and emits quoted prefix terms ("osmo"*), so
 *   operators like NEAR, OR, column filters or quotes can't be injected.
 * - Snippet highlight markers are private-use characters (U+E000/U+E001),
 *   never HTML; the same characters are stripped from indexed text so a
 *   note can't fake a highlight. The UI renders parts as plain Text.
 * - Queries and snippets are never logged.
 */
import { extractTextBlocks, type NoteDoc } from '@/core';

import { num, str, strOrNull } from './rows';
import type { SqlExecutor } from './sql';
import type { SearchHit, SearchMatch, SnippetPart } from './types';

export const MARK_OPEN = '\uE000';
export const MARK_CLOSE = '\uE001';
const MARKS = /[\uE000\uE001]/g;

export const SEARCH_LIMITS = {
  maxInputChars: 200,
  maxTerms: 8,
  maxTermChars: 40,
  maxRows: 200,
  maxNotes: 50,
  matchesPerNote: 3,
  /** Long blocks are indexed up to this many characters. */
  maxRowChars: 4_000,
} as const;

/** Ranking boost by row kind (bm25 is negative: more negative = better). */
const KIND_WEIGHT: Record<SearchMatch['kind'], number> = { title: 2, term: 1.6, heading: 1.4, text: 1 };

/** Builds a safe FTS5 MATCH expression, or null when there is nothing to search. */
export function parseSearchQuery(input: string): string | null {
  const terms = input
    .slice(0, SEARCH_LIMITS.maxInputChars)
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]+/gu);
  if (!terms) return null;
  return terms
    .slice(0, SEARCH_LIMITS.maxTerms)
    .map((t) => `"${t.slice(0, SEARCH_LIMITS.maxTermChars)}"*`)
    .join(' ');
}

export function splitSnippet(s: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let match = false;
  let buf = '';
  for (const ch of s) {
    if (ch === MARK_OPEN || ch === MARK_CLOSE) {
      if (buf) parts.push({ text: buf, match });
      buf = '';
      match = ch === MARK_OPEN;
    } else buf += ch;
  }
  if (buf) parts.push({ text: buf, match });
  return parts;
}

const clean = (s: string) => s.replace(MARKS, ' ').slice(0, SEARCH_LIMITS.maxRowChars);

export async function removeNoteFromIndex(tx: SqlExecutor, noteId: string): Promise<void> {
  await tx.run('DELETE FROM search WHERE rowid IN (SELECT rowid FROM searchMap WHERE noteId = ?)', [noteId]);
  await tx.run('DELETE FROM searchMap WHERE noteId = ?', [noteId]);
}

/** Replaces a note's rows. Call inside the transaction that saves the note. */
export async function indexNote(tx: SqlExecutor, noteId: string, title: string, doc: NoteDoc): Promise<number> {
  await removeNoteFromIndex(tx, noteId);
  const rows: { blockId: string | null; kind: SearchMatch['kind']; text: string }[] = [];
  if (title.trim()) rows.push({ blockId: null, kind: 'title', text: title });
  for (const b of extractTextBlocks(doc)) rows.push(b);
  for (const r of rows) {
    const { lastInsertRowid } = await tx.run('INSERT INTO searchMap (noteId, blockId, kind) VALUES (?, ?, ?)', [
      noteId,
      r.blockId,
      r.kind,
    ]);
    await tx.run('INSERT INTO search (rowid, text) VALUES (?, ?)', [lastInsertRowid, clean(r.text)]);
  }
  return rows.length;
}

export async function searchNotes(db: SqlExecutor, input: string): Promise<SearchHit[]> {
  const match = parseSearchQuery(input);
  if (!match) return [];
  const rows = await db.all(
    `SELECT m.noteId AS noteId, m.blockId AS blockId, m.kind AS kind,
            snippet(search, 0, char(57344), char(57345), '…', 12) AS snip,
            bm25(search) AS score,
            n.title AS title, n.subject AS subject, n.updated AS updated, n.stylePackId AS stylePackId
       FROM search
       JOIN searchMap m ON m.rowid = search.rowid
       JOIN notes n ON n.id = m.noteId
      WHERE search MATCH ? AND n.deleted = 0
      ORDER BY score
      LIMIT ?`,
    [match, SEARCH_LIMITS.maxRows],
  );
  const byNote = new Map<string, SearchHit>();
  for (const r of rows) {
    const kind = str(r.kind) as SearchMatch['kind'];
    const score = num(r.score) * (KIND_WEIGHT[kind] ?? 1);
    const noteId = str(r.noteId);
    let hit = byNote.get(noteId);
    if (!hit) {
      hit = {
        noteId,
        title: str(r.title),
        subject: strOrNull(r.subject),
        updated: num(r.updated),
        stylePackId: str(r.stylePackId),
        score: 0,
        matches: [],
      };
      byNote.set(noteId, hit);
    }
    hit.score = Math.min(hit.score, score);
    if (hit.matches.length < SEARCH_LIMITS.matchesPerNote) {
      hit.matches.push({ blockId: strOrNull(r.blockId), kind, snippet: splitSnippet(str(r.snip)) });
    }
  }
  return [...byNote.values()].sort((a, b) => a.score - b.score || b.updated - a.updated).slice(0, SEARCH_LIMITS.maxNotes);
}

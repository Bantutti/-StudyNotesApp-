/**
 * Domain types returned by the store. Field names and shapes are the cloud
 * docs' (P2a collections.ts), with timestamps as milliseconds and owner
 * null in guest mode.
 */
import type { NoteDoc } from '@/core';

export interface SyncedMeta {
  id: string;
  owner: string | null;
  created: number;
  updated: number;
  rev: number;
  deleted: boolean;
}

export interface Subject extends SyncedMeta {
  name: string;
  /** 6 hex digits without '#', as in the cloud. UI: `#${color}`. */
  color: string;
  icon: string;
  defaultPack: string | null;
  defaultTemplate: string | null;
  examDates: number[];
  aiAllowed: boolean;
  autoMakeCards: boolean;
}

export interface Folder extends SyncedMeta {
  subject: string | null;
  name: string;
  parent: string | null;
}

export interface NoteMeta extends SyncedMeta {
  subject: string | null;
  folder: string | null;
  title: string;
  inkLayerRef: string | null;
  stylePackId: string;
  templateId: string | null;
  tags: string[];
}

export interface Note extends NoteMeta {
  document: NoteDoc;
}

export interface NoteListItem extends NoteMeta {
  /** First text line of the note (from the search index), for list cards. */
  preview: string;
}

export const VERSION_REASONS = [
  'edit',
  'leave',
  'before_beautify',
  'before_pack',
  'before_template',
  'before_restore',
  'before_ai',
  'before_sync_merge',
] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];

export interface VersionMeta {
  id: string;
  note: string;
  created: number;
  reason: VersionReason;
  title: string;
  stylePackId: string;
}

export interface Version extends VersionMeta {
  document: NoteDoc;
}

export type NoteScope =
  | { scope: 'all' }
  /** folderId: undefined = every note without a subject, null = Inbox root only, id = that folder. */
  | { scope: 'inbox'; folderId?: string | null }
  /** folder: undefined = whole subject, null = subject root only, id = that folder. */
  | { scope: 'subject'; subjectId: string; folderId?: string | null };

export type NoteSort = 'updated' | 'created' | 'title';

export interface SnippetPart {
  text: string;
  match: boolean;
}

export interface SearchMatch {
  blockId: string | null;
  kind: 'title' | 'heading' | 'term' | 'text';
  snippet: SnippetPart[];
}

export interface SearchHit {
  noteId: string;
  title: string;
  subject: string | null;
  updated: number;
  stylePackId: string;
  score: number;
  matches: SearchMatch[];
}

/** Returned by deletes; pass to store.undo() within UNDO_WINDOW_MS. */
export type UndoToken =
  | { kind: 'notes'; at: number; noteIds: string[] }
  | { kind: 'subject'; at: number; subjectId: string; mode: 'move' | 'delete'; noteIds: string[]; folderIds: string[] }
  | { kind: 'folder'; at: number; folderId: string; noteIds: string[]; childFolderIds: string[] };

/** Decision Q11: 8 seconds to undo, then the text is wiped. */
export const UNDO_WINDOW_MS = 8_000;

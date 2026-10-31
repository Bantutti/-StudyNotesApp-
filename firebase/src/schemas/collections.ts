/**
 * collections.ts — one zod schema per cloud document (decision: top-level
 * collections, every doc carries `owner`).
 *
 * Field names follow Plan v0.2 §12 ("Data model (outline)"), camelCased.
 * Fields NOT in the plan (approved by Rey, Nov 1 2026, decision 5):
 *   schemaVersion, created, updated, rev, deleted (on more entities).
 * Fields in the plan that are deliberately NOT synced:
 *   User.email (Auth holds it — data minimization), Asset.localPath (a device
 *   file path), NoteVersion and AIJob (local only per the plan).
 *
 * Every schema is a z.strictObject: unknown keys are rejected, mirroring the
 * rules' keys().hasOnly(...). Every field is REQUIRED (nullable instead of
 * optional), mirroring the rules' keys().hasAll(...). This keeps the two in
 * lock-step and makes docs predictable. See docs/backend/DATA_MODEL.md §D.2.
 */
import { z } from 'zod';
import { definitionSchema, noteDocumentSchema, segmentsSchema, settingsSchema } from './content.js';
import {
  BLOCK_ID_PATTERN,
  DEVICE_ID_PATTERN,
  ENTITY_ID_PATTERN,
  HEX6_PATTERN,
  ICON_PATTERN,
  INTS,
  JSON_CAPS,
  LANGUAGE_PATTERN,
  LISTS,
  REF_ID_PATTERN,
  SCHEMA_VERSION,
  ASSET_FOLDER,
  STORAGE,
  TEXT,
  UID_MAX,
} from './limits.js';
import {
  bool,
  enumOf,
  int,
  intList,
  jsonString,
  literal,
  str,
  stringList,
  timestamp,
  timestampList,
} from './primitives.js';

// ---------------------------------------------------------------------------
// Shared field groups
// ---------------------------------------------------------------------------

const entityId = () => str(16, 64, ENTITY_ID_PATTERN);
const refId = () => str(1, 64, REF_ID_PATTERN);
const ownerUid = () => str(1, UID_MAX);

/** Fields on every synced, mutable doc (§D.3). */
const syncedMeta = {
  id: entityId(),
  owner: ownerUid(),
  schemaVersion: literal(SCHEMA_VERSION),
  created: timestamp('server'), // == request.time on create, then immutable
  updated: timestamp('server'), // == request.time on every write
  rev: int(1, INTS.revMax), // 1 on create, old + 1 on each update (conflict detection)
  deleted: bool(), // tombstone; hard delete only when true (or account deletion)
};

// ---------------------------------------------------------------------------
// users/{uid}
// ---------------------------------------------------------------------------

/** Plan: User (id, email, created, settings). Email intentionally not stored. */
export const userSchema = z.strictObject({
  id: ownerUid(), // == uid == doc id
  owner: ownerUid(), // == uid (kept for a uniform owner check)
  schemaVersion: literal(SCHEMA_VERSION),
  created: timestamp('server'),
  updated: timestamp('server'),
  rev: int(1, INTS.revMax),
  settings: jsonString(2, JSON_CAPS.settings, settingsSchema),
  /** Set (to server time) when account deletion starts; blocks new writes (§D.6). */
  deletionRequestedAt: timestamp('server').nullable(),
});

// ---------------------------------------------------------------------------
// subjects/{id} — plan: id, owner, name, color, icon, default pack, default
// template, exam dates, AI allowed, auto-make cards.
// ---------------------------------------------------------------------------
export const subjectSchema = z.strictObject({
  ...syncedMeta,
  name: str(1, TEXT.subjectName),
  color: str(6, 6, HEX6_PATTERN),
  icon: str(1, 40, ICON_PATTERN),
  defaultPack: refId().nullable(),
  defaultTemplate: refId().nullable(),
  examDates: timestampList(LISTS.examDates),
  aiAllowed: bool(),
  autoMakeCards: bool(),
});

// ---------------------------------------------------------------------------
// folders/{id} — plan: id, owner, subject, name, parent.
// ---------------------------------------------------------------------------
export const folderSchema = z.strictObject({
  ...syncedMeta,
  subject: entityId().nullable(),
  name: str(1, TEXT.folderName),
  parent: entityId().nullable(),
});

// ---------------------------------------------------------------------------
// notes/{id} — plan: id, owner, subject, folder, title, document JSON, ink
// layer reference, style pack id, template id, tags, created, updated, deleted.
// ---------------------------------------------------------------------------
export const noteSchema = z.strictObject({
  ...syncedMeta,
  subject: entityId().nullable(),
  folder: entityId().nullable(),
  title: str(0, TEXT.noteTitle),
  /** Capped JSON string (decision 3); inner tree checked by noteDocumentSchema. */
  document: jsonString(2, JSON_CAPS.document, noteDocumentSchema, JSON_CAPS.documentBytes),
  /** Asset id of the ink layer (type 'ink'), or null when the note has no drawing. */
  inkLayerRef: entityId().nullable(),
  stylePackId: refId(),
  templateId: refId().nullable(),
  tags: stringList(LISTS.tags, 1, TEXT.tag),
});

// ---------------------------------------------------------------------------
// cards/{id} — plan: id, owner, subject, note, source block id, type, front,
// back, source, source-changed flag, suspended. (+ deleted tombstone)
// ---------------------------------------------------------------------------
export const CARD_TYPES = ['basic', 'reversed', 'cloze'] as const;
export const CARD_SOURCES = ['definition', 'highlight', 'bookmark', 'ai', 'manual'] as const;

export const cardSchema = z.strictObject({
  ...syncedMeta,
  subject: entityId().nullable(),
  note: entityId().nullable(), // null for a manual card not tied to a note
  sourceBlockId: str(1, 64, BLOCK_ID_PATTERN).nullable(),
  type: enumOf(CARD_TYPES),
  front: str(1, TEXT.cardFront),
  back: str(0, TEXT.cardBack), // cloze cards can have an empty back
  source: enumOf(CARD_SOURCES),
  sourceChanged: bool(),
  suspended: bool(),
});

// ---------------------------------------------------------------------------
// reviewLogs/{id} — plan: id, card, rating, reviewed at, device. Append-only.
// No updated/rev/deleted: a log is never edited (rules deny every update).
// ---------------------------------------------------------------------------
export const reviewLogSchema = z.strictObject({
  id: entityId(),
  owner: ownerUid(),
  schemaVersion: literal(SCHEMA_VERSION),
  created: timestamp('server'),
  card: entityId(),
  rating: int(INTS.ratingMin, INTS.ratingMax), // 1 Again, 2 Hard, 3 Good, 4 Easy (FSRS)
  reviewedAt: timestamp('client'), // device time of the review (may be offline, days ago)
  device: str(1, 64, DEVICE_ID_PATTERN),
});

// ---------------------------------------------------------------------------
// recordings/{id} — plan: id, note, asset, duration, language, segments
// (start, end, text), bookmarks (ms).
// ---------------------------------------------------------------------------
export const recordingSchema = z.strictObject({
  ...syncedMeta,
  note: entityId(),
  /** null after "delete audio": transcript and anchors stay (plan §15). */
  asset: entityId().nullable(),
  duration: int(0, INTS.durationMaxMs), // milliseconds
  language: str(2, 12, LANGUAGE_PATTERN).nullable(),
  segments: jsonString(2, JSON_CAPS.segments, segmentsSchema),
  bookmarks: intList(LISTS.bookmarks, 0, INTS.bookmarkMaxMs), // ms offsets
});

// ---------------------------------------------------------------------------
// assets/{id} — plan: id, owner, type (audio, image, sticker), local path,
// cloud path, size. Added types: ink, pdf (§L.8.1, pending Rey's OK).
// ---------------------------------------------------------------------------
export const ASSET_TYPES = ['audio', 'image', 'sticker', 'ink', 'pdf'] as const;

export const assetSchema = z
  .strictObject({
    ...syncedMeta,
    type: enumOf(ASSET_TYPES),
    /** "users/{uid}/{folder}/{id}.{ext}" once uploaded; null while local-only. Checked in rules. */
    cloudPath: str(1, 300).nullable(),
    /** Bytes. Storage rules require the upload's size to equal this value. */
    size: int(0, STORAGE.audio.maxBytes),
  })
  .superRefine((a, ctx) => {
    // §D.5 — cross-field checks, mirrored in firestore.rules validAsset().
    const folder = ASSET_FOLDER[a.type];
    const cap = STORAGE[folder];
    if (a.size > cap.maxBytes) {
      ctx.addIssue({ code: 'custom', path: ['size'], message: `size exceeds ${cap.maxBytes} for ${a.type}` });
    }
    if (a.cloudPath !== null) {
      // Exact path: the owner's folder for this type, file named after the asset id.
      const expected = new RegExp(`^users/${escapeRegex(a.owner)}/${folder}/${escapeRegex(a.id)}[.](${cap.exts.join('|')})$`);
      if (!expected.test(a.cloudPath)) {
        ctx.addIssue({ code: 'custom', path: ['cloudPath'], message: 'cloudPath must be users/{owner}/{folder}/{id}.{ext}' });
      }
    }
  });

/** Escapes regex metacharacters (uids/ids are [A-Za-z0-9_-] in practice, but never trust that). */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// stylePacks/{id} — plan: id, owner, version, definition, created-from-reference flag.
// ---------------------------------------------------------------------------
export const stylePackSchema = z.strictObject({
  ...syncedMeta,
  version: int(1, INTS.packVersionMax),
  definition: jsonString(2, JSON_CAPS.definition, definitionSchema),
  createdFromReference: bool(),
});

// ---------------------------------------------------------------------------
// templates/{id} — plan: id, owner (null for built-in), version, definition.
// Built-in templates ship with the app and are never synced, so owner is
// always a uid in the cloud.
// ---------------------------------------------------------------------------
export const templateSchema = z.strictObject({
  ...syncedMeta,
  version: int(1, INTS.packVersionMax),
  definition: jsonString(2, JSON_CAPS.definition, definitionSchema),
});

// ---------------------------------------------------------------------------
// Registry used by tests, the deletion module and the sync module.
// ---------------------------------------------------------------------------

/** Top-level collection name -> schema. Order matters for account deletion (§D.6). */
export const COLLECTION_SCHEMAS = {
  reviewLogs: reviewLogSchema, // first: their delete rule may read cards
  cards: cardSchema,
  recordings: recordingSchema,
  notes: noteSchema,
  folders: folderSchema,
  subjects: subjectSchema,
  assets: assetSchema,
  stylePacks: stylePackSchema,
  templates: templateSchema,
} as const;

export type CollectionName = keyof typeof COLLECTION_SCHEMAS;
export const COLLECTION_NAMES = Object.keys(COLLECTION_SCHEMAS) as CollectionName[];

export type UserDoc = z.infer<typeof userSchema>;
export type SubjectDoc = z.infer<typeof subjectSchema>;
export type FolderDoc = z.infer<typeof folderSchema>;
export type NoteDoc = z.infer<typeof noteSchema>;
export type CardDoc = z.infer<typeof cardSchema>;
export type ReviewLogDoc = z.infer<typeof reviewLogSchema>;
export type RecordingDoc = z.infer<typeof recordingSchema>;
export type AssetDoc = z.infer<typeof assetSchema>;
export type StylePackDoc = z.infer<typeof stylePackSchema>;
export type TemplateDoc = z.infer<typeof templateSchema>;

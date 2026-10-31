/**
 * limits.ts — every numeric cap shared by the zod schemas AND mirrored by hand
 * in firestore.rules / storage.rules.
 *
 * WHY ONE FILE: the "schemas agree with rules" test (tests/rules/agreement.test.ts)
 * generates boundary values (max, max + 1, min - 1 …) from the zod schemas, which
 * read their numbers from here. If someone changes a number here but forgets the
 * rules file (or the reverse), that test fails. So this file is the single source
 * of truth for the numbers; the rules files carry a comment next to each copy.
 *
 * Each value cites its derivation in docs/backend/LIMITS.md as §L.x.
 */

/** Current cloud schema version. Every cloud doc stores it (§L.1). */
export const SCHEMA_VERSION = 1 as const;

/** Entity ids created by the app: 16..64 chars of [A-Za-z0-9_-] (§L.2). */
export const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** References that may also point at BUILT-IN packs/templates such as "pastel-highlight" (§L.2). */
export const REF_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Block ids inside the note document (stable ids from the plan) (§L.2). */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Device id stored on review logs; never a hardware id, just an app-generated label (§L.2). */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Firebase Auth uids are at most 128 chars (§L.2). */
export const UID_MAX = 128;

/** Hex color without '#', same convention as the style-pack schema v3 (§L.3). */
export const HEX6_PATTERN = /^[0-9a-fA-F]{6}$/;
/** Icon names are bundled icon keys, e.g. "flask" or "book-open" (§L.3). */
export const ICON_PATTERN = /^[a-z0-9-]{1,40}$/;
/** BCP-47-ish language tag: ISO-639-1/2 code plus optional region/script, e.g. "en", "tl", "ceb", "en-PH" (§L.3). */
export const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/** Text caps, in characters as measured by Firestore rules' string.size() (§L.4). */
export const TEXT = {
  subjectName: 80,
  folderName: 80,
  noteTitle: 200,
  tag: 40,
  cardFront: 2_000,
  cardBack: 2_000,
} as const;

/** List caps (§L.5). Small enough that the rules can check every element by unrolling. */
export const LISTS = {
  tags: 20,
  examDates: 10,
  /** Bookmarks: rules can check only the size, not each element (§L.5, documented gap). */
  bookmarks: 500,
} as const;

/** Capped JSON strings (decision 3) (§L.6). Lengths are characters; the byte cap is zod-only. */
export const JSON_CAPS = {
  /** Note document JSON. 600k chars keeps the whole doc under Firestore's 1 MiB limit for ASCII-heavy notes. */
  document: 600_000,
  /** UTF-8 byte cap for the document string (zod-only; rules count characters) (§L.6.1). */
  documentBytes: 900_000,
  /** Recording segments JSON (a 6-hour lecture at ~1 segment / 5 s ≈ 4,320 segments). */
  segments: 400_000,
  /** Style pack / template definition JSON. Pack v3 files are ~3–6 KB; 50k is generous headroom. */
  definition: 50_000,
  /** User settings JSON. */
  settings: 8_000,
} as const;

/** Inner-structure caps for the JSON strings (zod-only) (§L.6.2). */
export const JSON_INNER = {
  documentMaxDepth: 64,
  documentMaxNodes: 50_000,
  segmentsMaxCount: 5_000,
  segmentTextMax: 2_000,
  definitionMaxDepth: 12,
  settingsMaxDepth: 4,
} as const;

/** Integer ranges (§L.7). */
export const INTS = {
  revMax: 1_000_000_000,
  ratingMin: 1, // FSRS Again
  ratingMax: 4, // FSRS Easy
  /** Recording duration in ms: 6 hours (§L.7.1). */
  durationMaxMs: 21_600_000,
  bookmarkMaxMs: 21_600_000,
  packVersionMax: 10_000,
} as const;

/** Storage folders and their caps (§L.8). Asset.size must equal the uploaded byte size. */
export const STORAGE = {
  audio: { maxBytes: 64 * 1024 * 1024, contentTypes: ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac'], exts: ['m4a', 'aac', 'mp4'] },
  images: { maxBytes: 5 * 1024 * 1024, contentTypes: ['image/jpeg', 'image/png', 'image/webp'], exts: ['jpg', 'jpeg', 'png', 'webp'] },
  ink: { maxBytes: 5 * 1024 * 1024, contentTypes: ['application/json'], exts: ['json'] },
  attachments: { maxBytes: 20 * 1024 * 1024, contentTypes: ['application/pdf'], exts: ['pdf'] },
} as const;

export type StorageFolder = keyof typeof STORAGE;

/** Asset type -> Storage folder. 'ink' and 'pdf' are additions to the plan's (audio, image, sticker) list (§L.8.1). */
export const ASSET_FOLDER = {
  audio: 'audio',
  image: 'images',
  sticker: 'images',
  ink: 'ink',
  pdf: 'attachments',
} as const satisfies Record<string, StorageFolder>;

export type AssetType = keyof typeof ASSET_FOLDER;

/** Max page size the rules allow on any query (§L.9). */
export const QUERY_LIMIT_MAX = 500;

/** Allowed clock skew for client-provided review times (§L.10). */
export const REVIEW_FUTURE_SKEW_MS = 5 * 60 * 1000;

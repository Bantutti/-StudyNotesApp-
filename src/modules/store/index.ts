/** store: local-first SQLite data (tables mirror P2a's cloud docs), search and settings. */
export { openStore, type Store, type StoreDeps, type StoreInfo } from './store';
export { openExpoDriver, deleteExpoDatabase, DB_FILE } from './expoDriver';
export { createSqlDb, type SqlDb, type SqlDriver, type SqlExecutor, type SqlRow, type SqlValue, type SqlRunResult } from './sql';
export { MIGRATIONS, LATEST_SCHEMA, migrate, getUserVersion, type Migration } from './migrations';
export { parseSearchQuery, splitSnippet, SEARCH_LIMITS, MARK_OPEN, MARK_CLOSE } from './search';
export { cleanTags, cleanTitle, type CreateNoteInput, type NotePatch, type SaveResult } from './notes';
export { toHex6, WIPED_NAME, type CreateSubjectInput, type SubjectPatch } from './subjects';
export { VERSIONS_KEPT, hash53 } from './versions';
export { PACK_DEFINITION_MAX_CHARS, ERASED_DEFINITION, type StoredPack } from './stylePacks';
export { userSettingsSchema, LOCAL_USER_ID, KV_MAX_CHARS, type UserSettings } from './settings';
export * from './types';

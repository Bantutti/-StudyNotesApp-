/**
 * beautify: turns messy notes into structured pages.
 * - Beautify Lite (this phase): on-device rules, no network, no key.
 * - P3b adds the AI Beautify (P3a engine) as another EditorAction through
 *   the same editor action hook; Lite stays the offline fallback.
 */
export { beautifyLite, dropChars, KEY_TERMS_TITLE, type BeautifyReport } from './lite';

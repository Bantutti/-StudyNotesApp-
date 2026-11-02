/**
 * legal: C1's in-app legal pages, bundled (decision Q10: no public links;
 * readable offline; every page starts with C1's "Draft" line).
 * Source pinned in generated/legalDocs.ts; `npm run check:legal` guards drift.
 */
import { LEGAL_DOCS, LEGAL_SOURCE } from './generated/legalDocs';

export type LegalDocId = keyof typeof LEGAL_DOCS;
export const LEGAL_DOC_IDS = Object.keys(LEGAL_DOCS) as LegalDocId[];
export const isLegalDocId = (v: unknown): v is LegalDocId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(LEGAL_DOCS, v);
export { LEGAL_DOCS, LEGAL_SOURCE };
export { parseMarkdown, parseInline, type Block, type Inline } from './markdown';
export { LegalDoc } from './LegalDoc';

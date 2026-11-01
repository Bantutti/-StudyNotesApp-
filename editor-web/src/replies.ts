/**
 * Outgoing documents. Every document leaving the editor is normalized, then
 * validated with the app's schema. A document that fails becomes an error
 * (carrying the request id when it answers requestDoc), never a substitute:
 * an empty document here would be saved over the note by an editor action.
 */
import { validateNoteDoc } from '../../src/core/document/parse';
import type { ToNative } from '../../src/modules/editor/protocol';
import { normalizeDoc } from './normalize';

export type DocCheck = { ok: true; doc: unknown } | { ok: false; code: 'invalid_doc' | 'too_large' };

export function checkOutgoingDoc(editorJson: unknown): DocCheck {
  const r = validateNoteDoc(normalizeDoc(editorJson));
  if (r.ok) return { ok: true, doc: r.value };
  return { ok: false, code: r.error.code === 'too_large' ? 'too_large' : 'invalid_doc' };
}

/** The answer to requestDoc: the validated document, or an error with the same reqId. */
export function requestDocReply(editorJson: unknown, reqId: number): ToNative {
  const c = checkOutgoingDoc(editorJson);
  return c.ok ? { v: 1, type: 'doc', reqId, reason: 'request', doc: c.doc } : { v: 1, type: 'error', code: c.code, reqId };
}

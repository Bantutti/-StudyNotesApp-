/**
 * Typing diagnostics (developer menu > Typing diagnostics).
 *
 * Records keyboard and IME events so a real-phone test (Gboard, Samsung,
 * iOS) gives data instead of guesses. PRIVACY: metadata only. No typed
 * characters ever leave the page: printable keys become "char", event data
 * becomes its length, and the cursor is reported as offset/size numbers.
 * Off by default; native turns it on with { type: 'setDiagnostics', on }.
 */
import type { Editor } from '@tiptap/core';

import type { DiagEvent } from '../../src/modules/editor/protocol';

const NAMED_KEY = /^[A-Za-z]{2,20}$/; // Enter, Backspace, ArrowLeft, Unidentified...
const FLUSH_MS = 300;

export function createDiagnostics(editor: Editor, send: (events: DiagEvent[]) => void, t0: number) {
  let on = false;
  let buf: DiagEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const dom = editor.view.dom;

  const flush = () => {
    timer = null;
    if (buf.length) send(buf.splice(0, 50));
    if (buf.length) timer = setTimeout(flush, FLUSH_MS);
  };
  const cursor = () => {
    const $f = editor.state.selection.$from;
    return { offset: $f.parentOffset, size: $f.parent.content.size };
  };
  const push = (e: Omit<DiagEvent, 't'>) => {
    if (!on) return;
    buf.push({ t: Math.round(performance.now() - t0), ...e });
    if (buf.length > 500) buf = buf.slice(-500);
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  };

  const onKey = (e: KeyboardEvent) =>
    push({ kind: 'keydown', key: NAMED_KEY.test(e.key) ? e.key : 'char', keyCode: e.keyCode, composing: e.isComposing, ...cursor() });
  const onComp = (e: CompositionEvent) => push({ kind: e.type as DiagEvent['kind'], len: (e.data ?? '').length, composing: editor.view.composing, ...cursor() });
  const onBefore = (e: InputEvent) =>
    push({ kind: 'beforeinput', inputType: /^[a-zA-Z]{0,40}$/.test(e.inputType) ? e.inputType : 'other', len: (e.data ?? '').length, composing: e.isComposing, ...cursor() });
  const onInput = (e: Event) => push({ kind: 'input', inputType: ((e as InputEvent).inputType ?? '').slice(0, 40).replace(/[^a-zA-Z]/g, ''), composing: editor.view.composing, ...cursor() });
  const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => transaction.docChanged && push({ kind: 'transaction', composing: editor.view.composing, ...cursor() });

  const listeners: [string, EventListener][] = [
    ['keydown', onKey as EventListener],
    ['compositionstart', onComp as EventListener],
    ['compositionupdate', onComp as EventListener],
    ['compositionend', onComp as EventListener],
    ['beforeinput', onBefore as EventListener],
    ['input', onInput],
  ];

  return {
    set(next: boolean) {
      if (next === on) return;
      on = next;
      for (const [name, fn] of listeners) {
        if (on) dom.addEventListener(name, fn, { capture: true, passive: true });
        else dom.removeEventListener(name, fn, { capture: true });
      }
      if (on) editor.on('transaction', onTx);
      else editor.off('transaction', onTx);
    },
  };
}

import { decode, encode, toNativeSchema, toWebSchema } from '../protocol';

const ok = (m: unknown, s: typeof toNativeSchema | typeof toWebSchema) => decode(JSON.stringify(m), s).ok;

describe('bridge protocol: P1 messages', () => {
  it('accepts the new native -> web messages and rejects bad ones', () => {
    expect(ok({ v: 1, type: 'scrollToBlock', blockId: 'b_abcdefghij0123' }, toWebSchema)).toBe(true);
    expect(ok({ v: 1, type: 'scrollToBlock', blockId: '"><img>' }, toWebSchema)).toBe(false);
    expect(ok({ v: 1, type: 'setDiagnostics', on: true }, toWebSchema)).toBe(true);
    expect(ok({ v: 1, type: 'requestSelection', reqId: 3 }, toWebSchema)).toBe(true);
    expect(ok({ v: 1, type: 'command', name: 'cornell' }, toWebSchema)).toBe(true);
    expect(ok({ v: 1, type: 'command', name: 'insertHTML', arg: '<b>' }, toWebSchema)).toBe(false);
  });

  it('accepts toolbar state and selection answers', () => {
    expect(ok({ v: 1, type: 'state', block: 'heading2', marks: ['bold'], inTable: false, canUndo: true, canRedo: false }, toNativeSchema)).toBe(true);
    expect(ok({ v: 1, type: 'state', block: 'script', marks: [], inTable: false, canUndo: true, canRedo: false }, toNativeSchema)).toBe(false);
    expect(ok({ v: 1, type: 'selection', reqId: 1, blockIds: ['b_abcdefghij0123'] }, toNativeSchema)).toBe(true);
  });

  it('typing diagnostics carry metadata only: no text field, no single characters', () => {
    const ev = { t: 12, kind: 'beforeinput', inputType: 'insertCompositionText', len: 3, composing: true, offset: 4, size: 9 };
    expect(ok({ v: 1, type: 'diag', events: [ev] }, toNativeSchema)).toBe(true);
    expect(ok({ v: 1, type: 'diag', events: [{ ...ev, data: 'secret' }] }, toNativeSchema)).toBe(false);
    expect(ok({ v: 1, type: 'diag', events: [{ t: 1, kind: 'keydown', key: 'a' }] }, toNativeSchema)).toBe(false);
    expect(ok({ v: 1, type: 'diag', events: [{ t: 1, kind: 'keydown', key: 'Enter', keyCode: 13 }] }, toNativeSchema)).toBe(true);
    expect(ok({ v: 1, type: 'diag', events: [{ t: 1, kind: 'input', inputType: 'insert text' }] }, toNativeSchema)).toBe(false);
    expect(encode({ v: 1, type: 'setDiagnostics', on: false })).toBe('{"v":1,"type":"setDiagnostics","on":false}');
  });
});

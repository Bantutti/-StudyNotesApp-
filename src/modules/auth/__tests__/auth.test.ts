
import { makeStore } from '../../store/__tests__/helpers';
import { emailSchema, passwordSchema, toAuthError } from '../authService';
import { bindAccount, pauseSyncForSignOut } from '../binding';
import { CHUNK_CHARS, createSecureKeyValue, encodeKey, type SecureStorePort } from '../securePersistence';


function fakeSecureStore() {
  const m = new Map<string, string>();
  const port: SecureStorePort = {
    getItemAsync: async (k) => m.get(k) ?? null,
    setItemAsync: async (k, v) => {
      if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error(`bad key ${k}`);
      if (v.length > 2048) throw new Error('value too long');
      m.set(k, v);
    },
    deleteItemAsync: async (k) => {
      m.delete(k);
    },
  };
  return { m, port };
}

describe('secure session storage (Q8)', () => {
  it('encodes Firebase keys into SecureStore-safe keys', () => {
    expect(encodeKey('firebase:authUser:demo-api-key:[DEFAULT]')).toMatch(/^fbauth_[0-9a-f]+$/);
  });

  it('round-trips a large session in chunks and cleans up old chunks', async () => {
    const { m, port } = fakeSecureStore();
    const kv = createSecureKeyValue(port);
    const big = 'x'.repeat(CHUNK_CHARS * 3 + 5);
    await kv.setItem('firebase:authUser:k:[DEFAULT]', big);
    expect(await kv.getItem('firebase:authUser:k:[DEFAULT]')).toBe(big);
    expect(m.size).toBe(5);
    await kv.setItem('firebase:authUser:k:[DEFAULT]', 'small');
    expect(await kv.getItem('firebase:authUser:k:[DEFAULT]')).toBe('small');
    expect(m.size).toBe(2);
    await kv.removeItem('firebase:authUser:k:[DEFAULT]');
    expect(await kv.getItem('firebase:authUser:k:[DEFAULT]')).toBeNull();
    expect(m.size).toBe(0);
  });

  it('a torn write reads as signed out', async () => {
    const { m, port } = fakeSecureStore();
    const kv = createSecureKeyValue(port);
    await kv.setItem('k', 'y'.repeat(CHUNK_CHARS * 2));
    m.delete(`${encodeKey('k')}.1`);
    expect(await kv.getItem('k')).toBeNull();
  });
});

describe('input checks and error mapping', () => {
  it('normalises emails and requires 8+ character passwords', () => {
    expect(emailSchema.parse('  Rey@Example.COM ')).toBe('rey@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(passwordSchema.safeParse('1234567').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(true);
    expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });

  it('does not reveal whether an account exists', () => {
    expect(toAuthError({ code: 'auth/user-not-found' }).message).toBe(toAuthError({ code: 'auth/wrong-password' }).message);
    expect(toAuthError({ code: 'auth/invalid-credential' }).reason).toBe('wrong_credentials');
  });

  it('never keeps the server message', () => {
    const e = toAuthError({ code: 'auth/internal-error', message: 'rey@example.com leaked' });
    expect(e.reason).toBe('unknown');
    expect(e.message).not.toContain('rey@');
    expect(toAuthError({ code: 'auth/requires-recent-login' }).reason).toBe('reauth_required');
    expect(toAuthError({ code: 'auth/network-request-failed' }).code).toBe('network');
  });
});

describe('account binding (Q7)', () => {
  it('binds once, refuses another account, and sign-out keeps the binding', async () => {
    const { store } = await makeStore();
    expect(await bindAccount(store, 'uid-a')).toEqual({ ok: true, firstTime: true });
    expect(await bindAccount(store, 'uid-a')).toEqual({ ok: true, firstTime: false });
    expect(await bindAccount(store, 'uid-b')).toEqual({ ok: false, reason: 'other_account' });
    await store.sync.setEnabled(true);
    await pauseSyncForSignOut(store);
    expect(await store.sync.getState()).toMatchObject({ uid: 'uid-a', enabled: false });
  });

  it('after "Remove notes from this phone" another account can be used', async () => {
    const { store } = await makeStore();
    await bindAccount(store, 'uid-a');
    await store.wipeAll();
    expect(await bindAccount(store, 'uid-b')).toEqual({ ok: true, firstTime: true });
  });
});

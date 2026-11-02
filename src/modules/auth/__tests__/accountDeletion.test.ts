import { createLogger, memorySink } from '@/core';

import { makeStore } from '../../store/__tests__/helpers';
import { deleteAccountAndCloudData } from '../accountDeletion';
import { ReauthRequiredError } from '../p2aDeletion';

const logger = createLogger({ sink: memorySink(), minLevel: 'debug' });
const report = { storageFilesDeleted: 2, docsDeleted: {}, profileDeleted: true, authUserDeleted: true } as never;

function deps(provider: string, over: Partial<Parameters<typeof deleteAccountAndCloudData>[0]> = {}) {
  const order: string[] = [];
  const d = {
    auth: { currentUser: { providerData: [{ providerId: provider }] } } as never,
    firestore: {} as never,
    storage: {} as never,
    logger,
    stopSync: jest.fn(async () => void order.push('stop')),
    revokeApple: jest.fn(async () => void order.push('revoke')),
    deleteAccount: jest.fn(async () => {
      order.push('delete');
      return report;
    }),
    ...over,
  };
  return { d, order };
}

describe('account deletion wiring', () => {
  it('Apple: revokes the tokens, then stops sync, then deletes; local notes become guest notes', async () => {
    const { store } = await makeStore();
    await store.sync.bind('uid-1');
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', title: 'stays' });
    const { d, order } = deps('apple.com');
    const r = await deleteAccountAndCloudData(d, store, { appleAuthorizationCode: 'code-1' });
    expect(order).toEqual(['revoke', 'stop', 'delete']);
    expect(d.revokeApple).toHaveBeenCalledWith(d.auth, 'code-1');
    expect(r.appleRevoke).toBe('revoked');
    expect(await store.sync.getState()).toMatchObject({ uid: null, enabled: false });
    expect(await store.notes.get(n.id)).toMatchObject({ title: 'stays', owner: null });
  });

  it('a failed Apple revoke does not block deletion (the person gets the Apple ID hint)', async () => {
    const { store } = await makeStore();
    const { d } = deps('apple.com', { revokeApple: jest.fn(async () => Promise.reject(new Error('offline'))) });
    expect((await deleteAccountAndCloudData(d, store, { appleAuthorizationCode: 'c' })).appleRevoke).toBe('failed');
    expect(d.deleteAccount).toHaveBeenCalled();
  });

  it('email accounts never call the Apple revoke', async () => {
    const { store } = await makeStore();
    const { d, order } = deps('password');
    expect((await deleteAccountAndCloudData(d, store, { appleAuthorizationCode: null })).appleRevoke).toBe('not_apple');
    expect(order).toEqual(['stop', 'delete']);
  });

  it('"needs a recent sign-in" becomes reauth_required (the screen asks again and retries)', async () => {
    const { store } = await makeStore();
    await store.sync.bind('uid-1');
    const { d } = deps('password', { deleteAccount: jest.fn(async () => Promise.reject(new ReauthRequiredError('x'))) });
    await expect(deleteAccountAndCloudData(d, store, { appleAuthorizationCode: null })).rejects.toMatchObject({ reason: 'reauth_required' });
    expect((await store.sync.getState()).uid).toBe('uid-1'); // not reset until deletion finished
  });
});

/** The app lock around the navigator, with settings from this phone's store (kv "applock"). */
import type { ReactNode } from 'react';

import { t } from '@/core';
import { expoDeviceAuth, expoScreenPrivacy, LOCK_KEY, LOCK_NS, LockGate, lockKvSchema } from '@/modules/applock';

import { useStore } from './AppDataContext';
import { useLockRevision } from './lockRevision';

export function AppLockGate({ children }: { children: ReactNode }) {
  const store = useStore();
  const revision = useLockRevision();
  return (
    <LockGate
      storage={{ get: () => store.kv.get(LOCK_NS, LOCK_KEY, lockKvSchema) }}
      device={expoDeviceAuth}
      privacy={expoScreenPrivacy}
      revision={revision}
      appName={t('app.name')}
    >
      {children}
    </LockGate>
  );
}

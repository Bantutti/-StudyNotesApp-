/** A tiny shared counter so the LockGate reloads its settings after the App lock screen saves. */
import { useSyncExternalStore } from 'react';

let revision = 0;
const subs = new Set<() => void>();

export function bumpLockRevision(): void {
  revision += 1;
  subs.forEach((f) => f());
}

export function useLockRevision(): number {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => revision,
  );
}

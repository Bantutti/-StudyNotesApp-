/**
 * Connects the sync controller to the app's lifecycle: re-attaches it to the
 * store whenever the store (re)opens (start-up, Delete all data) and tells it
 * when the app goes to the background or comes back (scheduler). Renders
 * nothing. Mounted inside AppDataProvider.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAppData } from './AppDataContext';
import { useServices } from './ServicesContext';

export function SyncBridge() {
  const { cloud } = useServices();
  const { store } = useAppData();
  useEffect(() => {
    if (!cloud) return undefined;
    void cloud.sync.attach(store);
    const sub = AppState.addEventListener('change', (s) => cloud.sync.appActive(s === 'active'));
    return () => {
      sub.remove();
      cloud.sync.detach();
    };
  }, [cloud, store]);
  return null;
}

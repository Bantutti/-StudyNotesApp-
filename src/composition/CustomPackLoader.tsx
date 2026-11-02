/**
 * Keeps the pack registry's custom packs in step with the database: loads
 * them once the store is open, and again on every data change (a pack saved
 * on this phone, or one that arrives by sync). Renders nothing.
 */
import { useEffect } from 'react';

import { useAppData, useDataVersion } from './AppDataContext';
import { loadCustomPacks } from './customPacks';
import { useServices } from './ServicesContext';

export function CustomPackLoader() {
  const { packs, logger } = useServices();
  const { store } = useAppData();
  const version = useDataVersion();
  useEffect(() => {
    loadCustomPacks(store, packs, logger).catch(() => logger.warn('packs.custom_load_failed'));
  }, [store, packs, logger, version]);
  return null;
}

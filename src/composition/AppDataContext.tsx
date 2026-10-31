/**
 * React wrapper for the app data lifecycle (createAppDataController).
 * Shows a loading screen until the database is open, or a plain error
 * screen with Try again if it can't be opened.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { t, userMessage } from '@/core';
import { AppButton, AppScreen, BodyText, Snackbar, Spinner, Title } from '@/core/ui';
import type { Store, UndoToken } from '@/modules/store';

import { createAppDataController, type AppDataController, type AppDataDeps, type ChangeBus, type UndoController } from './appData';

interface AppData {
  store: Store;
  bus: ChangeBus;
  undo: UndoController;
  showUndo(message: string, token: UndoToken): void;
  /** Snackbar with Undo for an editor action (restores the previous document). */
  showActionUndo(message: string, run: () => Promise<void>): void;
  resetAll(): Promise<void>;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ deps, children }: { deps: AppDataDeps; children: ReactNode }) {
  const [ctl] = useState<AppDataController>(() => createAppDataController(deps, userMessage));
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot);

  useEffect(() => {
    void ctl.open();
    // Leaving the app ends the undo window and wipes deleted text right away.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') void ctl.undo.flush();
    });
    return () => {
      sub.remove();
      ctl.dispose();
    };
  }, [ctl]);

  const { status, pending } = snap;
  if (status.kind === 'loading') return <Spinner />;
  if (status.kind === 'error') {
    return (
      <AppScreen edges={['top', 'left', 'right', 'bottom']}>
        <Title>{t('app.name')}</Title>
        <BodyText>{status.message}</BodyText>
        <AppButton label="Try again" onPress={() => void ctl.open()} />
      </AppScreen>
    );
  }
  const value: AppData = {
    store: status.store,
    bus: ctl.bus,
    undo: ctl.undo,
    showUndo: (message, token) => ctl.undo.show(message, token),
    showActionUndo: (message, run) => ctl.undo.showAction(message, run),
    resetAll: () => ctl.resetAll(),
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      {pending ? <Snackbar message={pending.message} actionLabel={t('common.undo')} onAction={() => void ctl.undo.undo()} /> : null}
    </Ctx.Provider>
  );
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppDataProvider missing');
  return v;
}

export const useStore = (): Store => useAppData().store;

/** Changes after writes, undo or reset. Use it as an effect dependency to reload. */
export function useDataVersion(): number {
  const { bus } = useAppData();
  return useSyncExternalStore(bus.subscribe, () => bus.version);
}

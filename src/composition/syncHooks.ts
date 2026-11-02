/** React hooks over the sync controller (P2b). Screens use these, never Firebase. */
import { useEffect, useSyncExternalStore } from 'react';

import { useServices } from './ServicesContext';
import type { CloudRuntime } from './cloudRuntime';
import type { SyncView } from './syncController';

const OFF: SyncView = { kind: 'off' };
const noop = () => () => undefined;

/** The sync view for a given cloud runtime (null/undefined = { kind: 'off' }). */
export function useCloudSyncView(cloud: CloudRuntime | null | undefined): SyncView {
  return useSyncExternalStore(cloud ? cloud.sync.subscribe : noop, () => (cloud ? cloud.sync.view() : OFF));
}

/** The current sync view; { kind: 'off' } in builds without a Firebase config. */
export function useSyncView(): SyncView {
  return useCloudSyncView(useServices().cloud);
}

/**
 * For the note screen: re-reads the note from the server when it opens,
 * syncs soon after edits (at most every 30 s) and right after leaving, and
 * calls onRemoteChange when a pull changed this note.
 */
export function useNoteSync(noteId: string, onRemoteChange: () => void) {
  const { cloud } = useServices();
  useEffect(() => {
    if (!cloud) return undefined;
    cloud.sync.noteOpened(noteId);
    const off = cloud.sync.onNotesChanged((ids) => {
      if (ids.includes(noteId)) onRemoteChange();
    });
    return () => {
      off();
      cloud.sync.noteLeft();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribe once per note
  }, [cloud, noteId]);
  return { edited: () => cloud?.sync.noteEdited() };
}

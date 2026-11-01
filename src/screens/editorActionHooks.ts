/**
 * React side of the editor action hook (M7, plan 9.4).
 *
 * useEditorActions: the actions registered for one toolbar placement, kept
 * live, so P3b can register its "ai" action (placement 'sparkle') through
 * composition at any time and an open note shows it without reopening.
 * Actions with isAvailable() returning false for this note are left out.
 *
 * useEditorActionRunner: runs an action through runEditorAction (validate,
 * version, save, show, exact undo) with one action at a time.
 */
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { IdGenerator } from '@/core';
import { runEditorAction, type ActionOutcome } from '@/composition';
import type { EditorAction, EditorActionContext, EditorActionPlacement, EditorActionRegistry, EditorHost } from '@/modules/editor';
import type { Store } from '@/modules/store';

export type ActionAvailabilityContext = Omit<EditorActionContext, 'doc' | 'ids' | 'signal'>;

export function useEditorActions(
  registry: EditorActionRegistry,
  placement: EditorActionPlacement,
  ctx?: ActionAvailabilityContext | null,
): EditorAction[] {
  const rev = useSyncExternalStore(registry.subscribe, registry.revision, registry.revision);
  return useMemo(
    () =>
      registry.list(placement).filter((a) => {
        if (!a.isAvailable || !ctx) return true;
        try {
          return a.isAvailable(ctx);
        } catch {
          return false; // a faulty check hides the action rather than breaking the toolbar
        }
      }),
    // rev changes on every register/unregister
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, placement, ctx, rev],
  );
}

export interface ActionRunnerDeps {
  store: Store;
  ids: IdGenerator;
  host: EditorHost;
  noteId: string;
  /** outcome null means the action changed nothing (or the user cancelled). */
  onDone(action: EditorAction, outcome: ActionOutcome | null): void;
  onError(action: EditorAction, error: unknown): void;
}

export function useEditorActionRunner(deps: ActionRunnerDeps): { busy: string | null; run(action: EditorAction): Promise<void> } {
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef(false);
  const { store, ids, host, noteId, onDone, onError } = deps;
  const run = async (action: EditorAction) => {
    if (running.current) return; // one action at a time
    running.current = true;
    setBusy(action.id);
    try {
      const outcome = await runEditorAction(action, { store, ids, host }, noteId);
      onDone(action, outcome);
    } catch (e) {
      onError(action, e);
    } finally {
      running.current = false;
      setBusy(null);
    }
  };
  return { busy, run };
}

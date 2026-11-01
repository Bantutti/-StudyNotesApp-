/**
 * P3b wiring (composition root): registers the "ai" editor action in the
 * sparkle slot and renders the AI modal. Mounted once inside
 * AppDataProvider (src/app/_layout.tsx), because the action needs the store
 * to read the subject's "AI allowed" switch and Services has no store.
 *
 * The store changes after "Delete all data", so the action is re-registered
 * with the new store (the effect depends on it).
 */
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo } from 'react';

import { AiFlowHost, createAiEditorAction, docHasText, type AiScreenPorts, type ClipboardPort } from '@/modules/aiui';
import type { Store } from '@/modules/store';

import { useStore } from './AppDataContext';
import { useServices } from './ServicesContext';

/** expo-clipboard adapter (works in Expo Go). */
export const expoClipboard: ClipboardPort = {
  getString: () => Clipboard.getStringAsync(),
  setString: async (s) => {
    await Clipboard.setStringAsync(s);
  },
};

/** Subject switch, fail closed: unreadable means "not allowed" (build rules §1). */
export async function subjectAiAllowed(store: Store, subjectId: string | null): Promise<boolean> {
  if (!subjectId) return true; // Inbox notes have no subject switch
  const s = await store.subjects.get(subjectId);
  return s ? s.aiAllowed !== false : true; // a missing subject can't forbid it; a read error throws -> blocked
}

/** P1 bug guard: does the stored note have text? (A missing note counts as "no".) */
export async function storedNoteHasText(store: Store, noteId: string): Promise<boolean> {
  const n = await store.notes.get(noteId);
  return !!n && !n.deleted && docHasText(n.document);
}

export function useAiScreenPorts(): AiScreenPorts {
  const { links } = useServices();
  return useMemo(() => ({ openLink: (url: string) => void links(url), clipboard: expoClipboard }), [links]);
}

export function AiWiring() {
  const { aiui, editorActions } = useServices();
  const store = useStore();
  const ports = useAiScreenPorts();

  useEffect(
    () =>
      editorActions.register(
        createAiEditorAction({
          flow: aiui.flow,
          subjectAiAllowed: (id) => subjectAiAllowed(store, id),
          storedNoteHasText: (id) => storedNoteHasText(store, id),
        }),
      ),
    [editorActions, aiui, store],
  );

  return <AiFlowHost flow={aiui.flow} ports={ports} />;
}

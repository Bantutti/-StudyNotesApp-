/** Single-flight New action. A focus generation prevents late navigation after leaving. */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createNoteIn } from '@/composition';
import { userMessage } from '@/core';
import type { Store } from '@/modules/store';

export function useCreateBlankNote(store: Store, open: (id: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const focused = useRef(false);
  const generation = useRef(0);
  const flight = useRef<{ pending: boolean } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    generation.current += 1;
    // A completed navigation stays locked until focus actually leaves.
    if (!flight.current) setBusy(false);
    return () => {
      focused.current = false;
      generation.current += 1;
      if (flight.current && !flight.current.pending) flight.current = null;
    };
  }, []));

  const create = useCallback(async function create() {
    if (!mounted.current || !focused.current || flight.current) return;
    const current = { pending: true };
    const started = generation.current;
    flight.current = current; // synchronous: before React can commit a busy state
    setError(null);
    setBusy(true);
    const stillHere = () => mounted.current && focused.current && generation.current === started;
    let id: string;
    try {
      id = (await createNoteIn(store, { subject: null })).id;
    } catch (e) {
      flight.current = null;
      if (mounted.current) {
        setBusy(false);
        setError(`Could not create note. ${userMessage(e)} Use New note to try again.`);
      }
      return;
    }
    current.pending = false;
    if (!stillHere()) {
      flight.current = null;
      if (mounted.current) setBusy(false);
      return;
    }
    try {
      open(id);
    } catch {
      // Creation has already succeeded: retrying creation here could duplicate it.
      flight.current = null;
      if (stillHere()) {
        setBusy(false);
        setError('Note created, but could not be opened. Find it on Home and open it there.');
      }
    }
  }, [store, open]);
  return { busy, create, error };
}

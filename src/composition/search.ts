/**
 * Search-as-you-type controller (logic only): debounces input and drops
 * answers that arrive after a newer query, so the list never jumps back to
 * old results. Queries are never logged.
 */
import type { SearchHit, Store } from '@/modules/store';

export const SEARCH_DEBOUNCE_MS = 200;

export interface SearchState {
  query: string;
  hits: SearchHit[];
  /** True while a search for the current query is pending. */
  busy: boolean;
}

export function createSearchController(deps: {
  search: Store['search'];
  onChange: (s: SearchState) => void;
  debounceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}) {
  const setT = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let state: SearchState = { query: '', hits: [], busy: false };
  let timer: unknown = null;
  let seq = 0;
  const set = (s: Partial<SearchState>) => {
    state = { ...state, ...s };
    deps.onChange(state);
  };

  const runNow = async (query: string, mySeq: number) => {
    try {
      const hits = await deps.search(query);
      if (mySeq === seq) set({ hits, busy: false });
    } catch {
      if (mySeq === seq) set({ hits: [], busy: false });
    }
  };

  return {
    get state() {
      return state;
    },
    setQuery(query: string) {
      seq += 1;
      const mySeq = seq;
      if (timer !== null) clearT(timer);
      timer = null;
      if (!query.trim()) {
        set({ query, hits: [], busy: false });
        return;
      }
      set({ query, busy: true });
      timer = setT(() => {
        timer = null;
        void runNow(query, mySeq);
      }, deps.debounceMs ?? SEARCH_DEBOUNCE_MS);
    },
    /** Re-runs the current query (e.g. after notes changed). */
    refresh() {
      if (state.query.trim()) void runNow(state.query, seq);
    },
    dispose() {
      if (timer !== null) clearT(timer);
      seq += 1;
    },
  };
}
export type SearchController = ReturnType<typeof createSearchController>;

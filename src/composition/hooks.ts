import { useEffect, useState, useSyncExternalStore } from 'react';

import { DEFAULT_PACK_ID, missingFamilies, type FontFaceData, type PackRegistry, type StylePack } from '@/modules/stylepacks';

import { useServices } from './ServicesContext';

interface FaceState {
  key: string;
  faces: FontFaceData[];
  error: boolean;
}

/**
 * Re-renders when the custom packs change (P5: they load from the local
 * database after start-up, and Match a look adds new ones). Returns the
 * registry revision so callers can use it as a memo key.
 */
export function usePackRegistryRevision(packs: PackRegistry): number {
  return useSyncExternalStore(packs.subscribe, packs.revision, packs.revision);
}

/** Every pack the student can pick (built-ins in v1 order, then their own), plus the custom ids. */
export function usePackList(): { packs: StylePack[]; customIds: ReadonlySet<string> } {
  const { packs } = useServices();
  const rev = usePackRegistryRevision(packs);
  const [state, setState] = useState(() => ({ rev, list: packs.list(), customIds: new Set(packs.custom().map((p) => p.id)) }));
  if (state.rev !== rev) setState({ rev, list: packs.list(), customIds: new Set(packs.custom().map((p) => p.id)) });
  return { packs: state.list, customIds: state.customIds };
}

/** Current pack + its bundled font faces (loaded once, cached in Services). */
export function usePackFaces(packId: string) {
  const { packs, getFaces, logger } = useServices();
  usePackRegistryRevision(packs); // a custom pack that loads later replaces the default fallback
  const pack: StylePack = packs.getOrDefault(packId || DEFAULT_PACK_ID);
  const [loaded, setLoaded] = useState<FaceState | null>(null);

  useEffect(() => {
    let alive = true;
    getFaces(pack)
      .then((faces) => alive && setLoaded({ key: pack.id, faces, error: false }))
      .catch(() => {
        logger.warn('fonts.load_failed', { pack: pack.id });
        if (alive) setLoaded({ key: pack.id, faces: [], error: true });
      });
    return () => {
      alive = false;
    };
  }, [pack, getFaces, logger]);

  // Faces from a previous pack are never shown for the current one.
  const current = loaded && loaded.key === pack.id ? loaded : null;
  return { pack, faces: current ? current.faces : null, fontError: current?.error ?? false, missing: missingFamilies(pack) };
}

/** Template dependencies for createNoteIn / applyTemplateToNote. */
export function useTemplateDeps() {
  const { templates, ids } = useServices();
  return { templates, ids };
}

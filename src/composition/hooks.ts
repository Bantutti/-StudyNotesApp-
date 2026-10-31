import { useEffect, useState } from 'react';

import { DEFAULT_PACK_ID, missingFamilies, type FontFaceData, type StylePack } from '@/modules/stylepacks';

import { useServices } from './ServicesContext';

interface FaceState {
  key: string;
  faces: FontFaceData[];
  error: boolean;
}

/** Current pack + its bundled font faces (loaded once, cached in Services). */
export function usePackFaces(packId: string) {
  const { packs, getFaces, logger } = useServices();
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

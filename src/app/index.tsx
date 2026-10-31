/** Entry: first run goes to onboarding, everyone else to Home. */
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';

import { isOnboarded, useDataVersion, useStore } from '@/composition';
import { Spinner } from '@/core/ui';

export default function Entry() {
  const store = useStore();
  const version = useDataVersion();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    isOnboarded(store).then((v) => alive && setOnboarded(v));
    return () => {
      alive = false;
    };
  }, [store, version]);
  if (onboarded === null) return <Spinner />;
  return <Redirect href={onboarded ? '/home' : '/onboarding'} />;
}

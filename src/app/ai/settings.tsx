/**
 * Me -> AI settings (P3b). Thin route: the screen lives in @/modules/aiui.
 */
import { useMemo } from 'react';

import { useAiScreenPorts, useServices, useStore } from '@/composition';
import { AiSettingsScreen, type SubjectsPort } from '@/modules/aiui';

export default function AiSettingsRoute() {
  const { aiui, keyVault } = useServices();
  const store = useStore();
  const ports = useAiScreenPorts();
  const subjects = useMemo<SubjectsPort>(
    () => ({
      list: () => store.subjects.list(),
      setAiAllowed: async (id, allowed) => {
        await store.subjects.update(id, { aiAllowed: allowed });
      },
    }),
    [store],
  );
  return <AiSettingsScreen aiui={aiui} keyVault={keyVault} ports={ports} subjects={subjects} isDev={__DEV__} />;
}

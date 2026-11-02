/** Bundled legal pages (Q10): offline, no browser, C1's "Draft" line on top. */
import { router, Stack, useLocalSearchParams } from 'expo-router';

import { AppScreen, BodyText, Caption } from '@/core/ui';
import { isLegalDocId, LEGAL_DOCS, LEGAL_SOURCE, LegalDoc } from '@/modules/legal';

export default function LegalPage() {
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  if (!isLegalDocId(doc)) return <AppScreen><BodyText>This page doesn’t exist.</BodyText></AppScreen>;
  const d = LEGAL_DOCS[doc];
  return (
    <AppScreen>
      <Stack.Screen options={{ title: d.title }} />
      <LegalDoc markdown={d.markdown} onOpenDoc={(id) => router.push({ pathname: '/legal/[doc]', params: { doc: id } })} />
      <Caption>Version {LEGAL_SOURCE.commit.slice(0, 7)}</Caption>
    </AppScreen>
  );
}

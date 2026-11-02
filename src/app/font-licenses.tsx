/**
 * Font licences (P5): every bundled font family with its copyright line and
 * the full SIL Open Font License 1.1 text. OFL condition 2 requires the
 * licence to travel with the fonts; this screen is how it does in the app.
 * Data is generated from each font package's LICENSE_FONT (scripts/subset-fonts.mjs).
 */
import { ScrollView, StyleSheet, Text } from 'react-native';

import { AppScreen, Caption, SectionHeader, Surface, useTheme } from '@/core/ui';
import { FONT_NOTICES, OFL_TEXT } from '@/modules/stylepacks';

export default function FontLicences() {
  const th = useTheme();
  return (
    <AppScreen>
      <Caption>
        NotedPo bundles these fonts for its looks. Each one is licensed under the SIL Open Font License 1.1. Fonts marked
        &quot;Latin subset&quot; were reduced to Latin letters and common symbols to keep the app small.
      </Caption>
      {FONT_NOTICES.map((n) => (
        <Surface key={n.family}>
          <Text style={[styles.family, { color: th.text }]}>
            {n.family}
            {n.modified ? ' (Latin subset)' : ''}
          </Text>
          <Caption>{n.copyright}</Caption>
        </Surface>
      ))}
      <SectionHeader>SIL Open Font License 1.1</SectionHeader>
      <ScrollView horizontal={false}>
        <Text selectable style={[styles.licence, { color: th.muted }]}>
          {OFL_TEXT}
        </Text>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  family: { fontSize: 16, fontWeight: '700' },
  licence: { fontSize: 12, lineHeight: 17 },
});

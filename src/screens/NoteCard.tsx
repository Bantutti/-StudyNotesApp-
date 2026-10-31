/**
 * Note card in the note's own pack colours (plan 9.3: "thumbnails in the
 * note's pack"). Native, not a page render: paper colour, pack ink and muted
 * colours (both contrast-checked by the pack validator), an accent edge.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { displayTitle, relativeTime, SAMPLE_TAG, useServices } from '@/composition';
import { t } from '@/core';
import { useTheme } from '@/core/ui';
import type { NoteListItem } from '@/modules/store';

export function NoteCard({ note, now, onPress, onLongPress }: { note: NoteListItem; now: number; onPress: () => void; onLongPress?: () => void }) {
  const th = useTheme();
  const { packs } = useServices();
  const pack = packs.getOrDefault(note.stylePackId);
  const title = displayTitle(note);
  const preview = note.title.trim() && note.preview && note.preview !== note.title ? note.preview : '';
  const isSample = note.tags.includes(SAMPLE_TAG);
  const tags = note.tags.filter((x) => x !== SAMPLE_TAG).slice(0, 3);
  return (
    <Pressable
      testID={`note-${note.id}`}
      accessibilityRole="button"
      accessibilityLabel={[isSample ? t('common.sample') : null, title, preview, relativeTime(note.updated, now)].filter(Boolean).join(', ')}
      accessibilityHint="Opens the note. Long press for more options."
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pack.paper.color, borderColor: th.line, borderLeftColor: pack.palette.accent, borderRadius: th.radius.card },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.head}>
        <Text numberOfLines={1} style={[styles.title, { color: pack.palette.ink }]}>
          {title}
        </Text>
        {isSample ? (
          <Text style={[styles.badge, { color: pack.palette.ink, backgroundColor: pack.palette.soft }]}>{t('common.sample')}</Text>
        ) : null}
      </View>
      {preview ? (
        <Text numberOfLines={2} style={[styles.preview, { color: pack.palette.muted }]}>
          {preview}
        </Text>
      ) : null}
      <View style={styles.foot}>
        <Text style={[styles.meta, { color: pack.palette.muted }]}>{relativeTime(note.updated, now)}</Text>
        {tags.map((tag) => (
          <Text key={tag} style={[styles.tag, { color: pack.palette.ink, backgroundColor: pack.palette.soft }]}>
            #{tag}
          </Text>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 5, paddingHorizontal: 14, paddingVertical: 12, gap: 6, minHeight: 64 },
  pressed: { opacity: 0.75 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: '700' },
  badge: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  preview: { fontSize: 14, lineHeight: 20 },
  foot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  meta: { fontSize: 12 },
  tag: { fontSize: 12, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' },
});

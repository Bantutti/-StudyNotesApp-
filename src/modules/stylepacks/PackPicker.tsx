/**
 * Grid of pack swatches (P5, Q9 = A). One tap selects; the screen above it
 * shows a single live page preview of the selection (P1's PagePreview).
 * Every card is a radio button for screen readers; colour is never the only
 * cue (name and a check icon mark the selection, plan §16 accessibility).
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Caption, Icon, useTheme } from '@/core/ui';

import type { StylePack } from './schema';
import { swatchLabel, swatchModel, SWATCH_HEIGHT, type SwatchModel } from './swatch';

function PatternLayer({ m }: { m: SwatchModel }) {
  if (m.pattern === 'plain') return null;
  const step = SWATCH_HEIGHT / (m.rows + 1);
  const rows = Array.from({ length: m.rows }, (_, i) => (i + 1) * step);
  if (m.pattern === 'dotted') {
    return (
      <>
        {rows.map((y) =>
          [0.15, 0.35, 0.55, 0.75, 0.95].map((x) => (
            <View key={`${y}-${x}`} style={[styles.dot, { top: y, left: `${x * 100}%`, backgroundColor: m.line }]} />
          )),
        )}
      </>
    );
  }
  return (
    <>
      {rows.map((y) => (
        <View key={y} style={[styles.hline, { top: y, backgroundColor: m.line }]} />
      ))}
      {m.pattern === 'grid'
        ? [0.2, 0.4, 0.6, 0.8].map((x) => <View key={x} style={[styles.vline, { left: `${x * 100}%`, backgroundColor: m.line }]} />)
        : null}
    </>
  );
}

/** A miniature page: pattern, a header word in the accent over the first highlighter, ink lines, highlighter dots. */
export function PackSwatch({ m }: { m: SwatchModel }) {
  return (
    <View style={[styles.page, { backgroundColor: m.paper }]} accessible={false}>
      <PatternLayer m={m} />
      <View style={styles.headerRow}>
        <View style={[styles.headerMark, { backgroundColor: m.highlights[0] ?? m.paper }]} />
        <Text style={[styles.headerText, { color: m.accent }]}>Aa</Text>
      </View>
      <View style={[styles.inkLine, { backgroundColor: m.ink, width: '78%' }]} />
      <View style={[styles.inkLine, { backgroundColor: m.ink, width: '62%' }]} />
      <View style={styles.dots}>
        {m.highlights.map((h, i) => (
          <View key={`${h}-${i}`} style={[styles.hl, { backgroundColor: h, borderColor: m.ink }]} />
        ))}
      </View>
    </View>
  );
}

export function PackPicker(props: {
  packs: readonly StylePack[];
  /** Ids of custom packs among `packs` (shown with a "Yours" tag). */
  customIds?: ReadonlySet<string>;
  selected: string;
  onSelect: (id: string) => void;
  testIDPrefix?: string;
}) {
  const th = useTheme();
  const models = useMemo(
    () => props.packs.map((p) => swatchModel(p, props.customIds?.has(p.id) ?? false)),
    [props.packs, props.customIds],
  );
  return (
    <View style={styles.grid} accessibilityRole="radiogroup">
      {models.map((m) => {
        const sel = m.id === props.selected;
        return (
          <Pressable
            key={m.id}
            testID={`${props.testIDPrefix ?? 'pack'}-${m.id}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel }}
            accessibilityLabel={swatchLabel(m)}
            onPress={() => props.onSelect(m.id)}
            style={[styles.card, { borderColor: sel ? th.accent : th.line, backgroundColor: th.surface, borderRadius: th.radius.card }]}
          >
            <PackSwatch m={m} />
            <View style={styles.nameRow}>
              <Text numberOfLines={1} style={[styles.name, { color: th.text }]}>
                {m.name}
              </Text>
              {sel ? <Icon name="checkmark-circle" size={20} color={th.accent} /> : null}
            </View>
            <Caption>{m.custom ? 'Yours' : m.dark ? 'Dark' : 'Light'}</Caption>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: { width: '48%', borderWidth: 2, padding: 6, gap: 4, minHeight: 44 },
  page: { height: SWATCH_HEIGHT, borderRadius: 8, overflow: 'hidden', padding: 10, gap: 8 },
  hline: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth * 2 },
  vline: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth * 2 },
  dot: { position: 'absolute', width: 2, height: 2, borderRadius: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerMark: { position: 'absolute', left: -2, right: '55%', top: 6, bottom: 2, borderRadius: 3 },
  headerText: { fontSize: 22, fontWeight: '700' },
  inkLine: { height: 3, borderRadius: 2, opacity: 0.85 },
  dots: { flexDirection: 'row', gap: 5, marginTop: 'auto' },
  hl: { width: 14, height: 14, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, paddingHorizontal: 2 },
  name: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
});

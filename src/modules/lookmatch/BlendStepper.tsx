/**
 * The "closer to your photo / closer to <pack>" control (§9): 11 positions.
 * A row of tap targets plus − and + buttons, and one accessible
 * "adjustable" element so screen readers can swipe up/down to change it.
 * (No slider dependency: React Native core has none, and 11 discrete steps
 * are easier to hit than a thin track.)
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, useTheme } from '@/core/ui';

export function BlendStepper(props: {
  steps: number;
  value: number;
  onChange: (v: number) => void;
  leftLabel: string;
  rightLabel: string;
  disabled?: boolean;
}) {
  const th = useTheme();
  const max = props.steps - 1;
  const set = (v: number) => !props.disabled && props.onChange(Math.min(max, Math.max(0, v)));
  const pct = Math.round((props.value / max) * 100);
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Look: ${props.leftLabel} to ${props.rightLabel}`}
      accessibilityValue={{ min: 0, max: 100, now: pct, text: `${pct}% toward ${props.rightLabel}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => set(props.value + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
      style={styles.wrap}
    >
      <View style={styles.labels}>
        <Text style={[styles.label, { color: th.muted }]}>{props.leftLabel}</Text>
        <Text style={[styles.label, { color: th.muted, textAlign: 'right' }]}>{props.rightLabel}</Text>
      </View>
      <View style={styles.row}>
        <Pressable accessible={false} onPress={() => set(props.value - 1)} hitSlop={10} style={styles.btn} testID="blend-minus">
          <Icon name="remove-circle-outline" size={28} color={th.accent} />
        </Pressable>
        <View style={styles.track}>
          {Array.from({ length: props.steps }, (_, i) => (
            <Pressable key={i} accessible={false} onPress={() => set(i)} hitSlop={6} style={styles.dotHit} testID={`blend-${i}`}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: i <= props.value ? th.accent : th.line, transform: [{ scale: i === props.value ? 1.5 : 1 }] },
                ]}
              />
            </Pressable>
          ))}
        </View>
        <Pressable accessible={false} onPress={() => set(props.value + 1)} hitSlop={10} style={styles.btn} testID="blend-plus">
          <Icon name="add-circle-outline" size={28} color={th.accent} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  label: { fontSize: 13, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dotHit: { minHeight: 44, minWidth: 16, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});

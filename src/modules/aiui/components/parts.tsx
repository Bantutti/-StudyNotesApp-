/**
 * Small building blocks for the AI screens, on the app chrome theme
 * (Plan 9.5 tokens: radius 8 chips / 12 inputs / 16 cards, 44-pt targets).
 * Every control has an accessibility role and label.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Icon, TOUCH_MIN, useTheme, type IconName } from '@/core/ui';

/** A selectable pill (scope, provider, report reason, month). */
export function Chip(props: { label: string; selected: boolean; onPress: () => void; disabled?: boolean; testID?: string; hint?: string }) {
  const th = useTheme();
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="radio"
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      accessibilityState={{ selected: props.selected, disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: th.radius.chip,
          borderColor: props.selected ? th.accent : th.line,
          backgroundColor: props.selected ? th.primary.fill : th.surface,
        },
        (pressed || props.disabled) && styles.dim,
      ]}
    >
      <Text style={{ color: props.selected ? th.primary.text : th.text, fontWeight: '600', fontSize: th.type.body }}>{props.label}</Text>
    </Pressable>
  );
}

/** A small status tag ("AI-added", "Changed since", "DEMO"). */
export function Tag({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'warn' | 'accent' }) {
  const th = useTheme();
  const color = tone === 'warn' ? th.warnText : tone === 'accent' ? th.accentText : th.muted;
  return (
    <Text style={[styles.tag, { color, borderColor: color, borderRadius: th.radius.chip, fontSize: th.type.caption }]} accessibilityRole="text">
      {text}
    </Text>
  );
}

/** A tappable row with an icon, a title and a one-line description (action list). */
export function OptionRow(props: { icon: IconName; title: string; subtitle?: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const th = useTheme();
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={[props.title, props.subtitle].filter(Boolean).join(', ')}
      accessibilityState={{ disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: th.surface, borderRadius: th.radius.card, borderColor: th.line },
        (pressed || props.disabled) && styles.dim,
      ]}
    >
      <Icon name={props.icon} color={props.disabled ? th.muted : th.accent} />
      <View style={styles.flex}>
        <Text style={{ color: th.text, fontSize: th.type.body, fontWeight: '600' }}>{props.title}</Text>
        {props.subtitle ? <Text style={{ color: th.muted, fontSize: th.type.caption, marginTop: 2 }}>{props.subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

/** A labelled on/off switch with a 44-pt row. */
export function ToggleRow(props: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; testID?: string; detail?: string }) {
  const th = useTheme();
  return (
    <View style={styles.toggle}>
      <View style={styles.flex}>
        <Text style={{ color: th.text, fontSize: th.type.body }}>{props.label}</Text>
        {props.detail ? <Text style={{ color: th.muted, fontSize: th.type.caption }}>{props.detail}</Text> : null}
      </View>
      <Switch
        testID={props.testID}
        accessibilityLabel={props.label}
        value={props.value}
        onValueChange={props.onChange}
        disabled={props.disabled}
        trackColor={{ true: th.accent, false: th.line }}
      />
    </View>
  );
}

/** A plain notice box (info or warning), announced to screen readers. */
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const th = useTheme();
  const color = tone === 'warn' ? th.warnText : th.text;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.notice, { borderRadius: th.radius.input, borderColor: tone === 'warn' ? th.warn : th.line, backgroundColor: th.surface }]}
    >
      <Text style={{ color, fontSize: th.type.body, lineHeight: 22 }}>{children}</Text>
    </View>
  );
}

/** A labelled block of plain text (consent screen sections). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const th = useTheme();
  return (
    <View style={{ gap: th.space.xs }}>
      <Text accessibilityRole="header" style={{ color: th.muted, fontSize: th.type.caption, fontWeight: '700' }}>
        {label}
      </Text>
      <Text style={{ color: th.text, fontSize: th.type.body, lineHeight: 22 }}>{children}</Text>
    </View>
  );
}

/** A text link button (opens a page OUTSIDE the app through the link opener). */
export function LinkButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const th = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="link" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={styles.link}>
      <Text style={{ color: th.accentText, fontSize: th.type.body, textDecorationLine: 'underline' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.55 },
  chip: { minHeight: TOUCH_MIN, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1 },
  tag: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1, alignSelf: 'flex-start', overflow: 'hidden', fontWeight: '700' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth },
  toggle: { minHeight: TOUCH_MIN, flexDirection: 'row', alignItems: 'center', gap: 12 },
  notice: { borderWidth: 1, padding: 12 },
  link: { minHeight: TOUCH_MIN, justifyContent: 'center' },
});

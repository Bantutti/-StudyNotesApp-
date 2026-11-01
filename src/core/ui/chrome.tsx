/**
 * App chrome components (plan 9.1 / 9.5): quiet neutral surfaces, 16-pt
 * cards, 44-pt touch targets, system fonts, Dynamic Type respected.
 * Every control has an accessibility role and label.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from './ThemeContext';
import { TOUCH_MIN } from './tokens';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const th = useTheme();
  return <Ionicons name={name} size={size} color={color ?? th.text} accessibilityElementsHidden importantForAccessibility="no" />;
}

export function AppScreen({
  children,
  scroll = true,
  edges = ['left', 'right'],
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  padded?: boolean;
}) {
  const th = useTheme();
  const pad = padded ? { padding: th.space.l, gap: th.space.l } : null;
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: th.bg }]} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={[pad, styles.grow]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, pad]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children, size = 'title' }: { children: ReactNode; size?: 'largeTitle' | 'title' }) {
  const th = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: th.text, fontSize: th.type[size], fontWeight: '700' }}>
      {children}
    </Text>
  );
}

export function BodyText({ children, muted, center }: { children: ReactNode; muted?: boolean; center?: boolean }) {
  const th = useTheme();
  return (
    <Text style={{ color: muted ? th.muted : th.text, fontSize: th.type.body, lineHeight: 22, textAlign: center ? 'center' : 'left' }}>
      {children}
    </Text>
  );
}

export function Caption({ children, color }: { children: ReactNode; color?: string }) {
  const th = useTheme();
  return <Text style={{ color: color ?? th.muted, fontSize: th.type.caption }}>{children}</Text>;
}

export function SectionHeader({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const th = useTheme();
  return (
    <View style={styles.rowBetween}>
      <Text accessibilityRole="header" style={{ color: th.muted, fontSize: th.type.caption, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' }}>
        {children}
      </Text>
      {action}
    </View>
  );
}

export function Surface({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const th = useTheme();
  return (
    <View style={[{ backgroundColor: th.surface, borderRadius: th.radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: th.line, padding: th.space.l, gap: th.space.s }, style]}>
      {children}
    </View>
  );
}

type Kind = 'primary' | 'secondary' | 'danger' | 'plain';

export function AppButton(props: {
  label: string;
  onPress: () => void;
  kind?: Kind;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
  testID?: string;
}) {
  const th = useTheme();
  const kind = props.kind ?? 'primary';
  const disabled = !!(props.disabled || props.busy);
  const fg = kind === 'primary' ? th.primary.text : kind === 'danger' ? th.dangerText : th.accentText;
  const bg = kind === 'primary' ? th.primary.fill : kind === 'plain' ? 'transparent' : th.surface;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      accessibilityState={{ disabled, busy: !!props.busy }}
      onPress={props.onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderRadius: th.radius.input, borderColor: kind === 'secondary' || kind === 'danger' ? th.line : 'transparent' },
        (pressed || disabled) && styles.dim,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.rowCenter}>
          {props.icon ? <Icon name={props.icon} size={20} color={fg} /> : null}
          <Text style={{ color: fg, fontSize: th.type.body, fontWeight: '600' }}>{props.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton(props: { icon: IconName; label: string; onPress: () => void; color?: string; disabled?: boolean; testID?: string }) {
  const th = useTheme();
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!props.disabled }}
      hitSlop={6}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.iconButton, (pressed || props.disabled) && styles.dim]}
    >
      <Icon name={props.icon} color={props.color ?? th.text} />
    </Pressable>
  );
}

/** A tappable list row: leading colour dot or icon, title, subtitle, trailing text. */
export function ListRow(props: {
  title: string;
  subtitle?: string;
  trailing?: string;
  icon?: IconName;
  dot?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  hint?: string;
  testID?: string;
  destructive?: boolean;
}) {
  const th = useTheme();
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole={props.onPress ? 'button' : undefined}
      accessibilityLabel={[props.title, props.subtitle, props.trailing].filter(Boolean).join(', ')}
      accessibilityHint={props.hint}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      style={({ pressed }) => [styles.listRow, { backgroundColor: th.surface, borderRadius: th.radius.card, borderColor: th.line }, pressed && styles.dim]}
    >
      {props.dot ? <View style={[styles.dot, { backgroundColor: props.dot }]} /> : null}
      {props.icon ? <Icon name={props.icon} color={props.destructive ? th.dangerText : th.muted} /> : null}
      <View style={styles.flex}>
        <Text numberOfLines={1} style={{ color: props.destructive ? th.dangerText : th.text, fontSize: th.type.body, fontWeight: '600' }}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text numberOfLines={2} style={{ color: th.muted, fontSize: th.type.caption, marginTop: 2 }}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.trailing ? <Text style={{ color: th.muted, fontSize: th.type.caption }}>{props.trailing}</Text> : null}
      {props.onPress ? <Icon name="chevron-forward" size={18} color={th.muted} /> : null}
    </Pressable>
  );
}

export function EmptyState({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  const th = useTheme();
  return (
    <View style={[styles.empty, { gap: th.space.m }]}>
      <Text accessibilityRole="header" style={{ color: th.text, fontSize: th.type.title, fontWeight: '700', textAlign: 'center' }}>
        {title}
      </Text>
      {body ? <BodyText muted center>{body}</BodyText> : null}
      {children}
    </View>
  );
}

export function TextField(props: TextInputProps & { label: string; error?: string | null }) {
  const th = useTheme();
  const { label, error, style, ...rest } = props;
  return (
    <View style={{ gap: th.space.xs }}>
      <Text style={{ color: th.text, fontSize: th.type.caption, fontWeight: '600' }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={th.muted}
        {...rest}
        style={[
          styles.input,
          { color: th.text, backgroundColor: th.surface, borderColor: error ? th.danger : th.line, borderRadius: th.radius.input, fontSize: th.type.body },
          style,
        ]}
      />
      {error ? <Text style={{ color: th.dangerText, fontSize: th.type.caption }}>{error}</Text> : null}
    </View>
  );
}

/** A round colour swatch button for subject colours. */
export function Swatch({ color, selected, onPress, label }: { color: string; selected: boolean; onPress: () => void; label: string }) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.swatch, { backgroundColor: color, borderColor: selected ? th.text : 'transparent' }]}
    >
      {selected ? <Ionicons name="checkmark" size={20} color="#FFFFFF" /> : null}
    </Pressable>
  );
}

export function Spinner() {
  const th = useTheme();
  return (
    <View style={[styles.fill, styles.center, { backgroundColor: th.bg }]}>
      <ActivityIndicator color={th.accent} accessibilityLabel="Loading" />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  flex: { flex: 1, minWidth: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowCenter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  button: { minHeight: TOUCH_MIN + 4, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  iconButton: { minWidth: TOUCH_MIN, minHeight: TOUCH_MIN, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.6 },
  listRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth },
  dot: { width: 14, height: 14, borderRadius: 7 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  input: { minHeight: TOUCH_MIN + 4, borderWidth: 1, paddingHorizontal: 14 },
  swatch: { width: TOUCH_MIN, height: TOUCH_MIN, borderRadius: TOUCH_MIN / 2, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});

/** Bottom snackbar with one action (Undo). Announced to screen readers. */
export function Snackbar({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) {
  const th = useTheme();
  const bg = th.scheme === 'dark' ? '#ECECEE' : '#1F2328';
  const fg = th.scheme === 'dark' ? '#1F2328' : '#FFFFFF';
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[snack.box, { backgroundColor: bg, borderRadius: th.radius.input }]}>
      <Text style={[snack.text, { color: fg }]} numberOfLines={2}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction} style={snack.action} hitSlop={8}>
          <Text style={{ color: fg, fontWeight: '700', textDecorationLine: 'underline' }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const snack = StyleSheet.create({
  box: { position: 'absolute', left: 16, right: 16, bottom: 24, minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12, elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  text: { flex: 1, fontSize: 15 },
  action: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});

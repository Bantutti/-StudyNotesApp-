import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ui } from './theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger';

export function Button(props: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
}) {
  const kind = props.kind ?? 'primary';
  const disabled = props.disabled || props.busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!props.busy }}
      onPress={props.onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        kind === 'primary' && styles.btnPrimary,
        kind === 'secondary' && styles.btnSecondary,
        kind === 'danger' && styles.btnDanger,
        (pressed || disabled) && styles.btnDim,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={kind === 'secondary' ? ui.accent : ui.paper} />
      ) : (
        <Text style={[styles.btnText, kind === 'secondary' && styles.btnTextSecondary]}>{props.label}</Text>
      )}
    </Pressable>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{String(value)}</Text>
    </View>
  );
}

export function Banner({ tone = 'warn', children }: { tone?: 'warn' | 'info'; children: ReactNode }) {
  return (
    <View style={[styles.banner, tone === 'info' && styles.bannerInfo]} accessibilityRole="alert">
      <Text style={[styles.bannerText, tone === 'info' && styles.bannerInfoText]}>{children}</Text>
    </View>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Verdict({ verdict }: { verdict: 'pass' | 'fail' | 'info' | 'untested' }) {
  const color =
    verdict === 'pass' ? ui.pass : verdict === 'fail' ? ui.fail : verdict === 'info' ? ui.info : ui.muted;
  return <Text style={[styles.verdict, { color, borderColor: color }]}>{verdict.toUpperCase()}</Text>;
}

/** Labels representative data in the UI itself (not only in docs). */
export function SampleBadge({ text = 'SAMPLE DATA' }: { text?: string }) {
  return <Text style={styles.sample}>{text}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.canvas },
  content: { padding: 16, gap: ui.gap },
  fill: { flex: 1 },
  card: {
    backgroundColor: ui.paper,
    borderRadius: ui.radius,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: ui.line,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: ui.ink },
  btn: { minHeight: 48, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: ui.accent },
  btnSecondary: { backgroundColor: ui.paper, borderWidth: 1.5, borderColor: ui.accent },
  btnDanger: { backgroundColor: ui.fail },
  btnDim: { opacity: 0.6 },
  btnText: { color: ui.paper, fontWeight: '700', fontSize: 15 },
  btnTextSecondary: { color: ui.accent },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { minWidth: 120, flexGrow: 1, backgroundColor: ui.soft, borderRadius: 10, padding: 10 },
  statLabel: { fontSize: 12, color: ui.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: 18, fontWeight: '700', color: ui.ink, marginTop: 2 },
  banner: { backgroundColor: ui.warnBg, borderRadius: 10, padding: 12 },
  bannerInfo: { backgroundColor: '#E8EEFB' },
  bannerText: { color: ui.warnInk, fontSize: 14, lineHeight: 20 },
  bannerInfoText: { color: ui.info },
  body: { color: ui.ink, fontSize: 15, lineHeight: 22 },
  muted: { color: ui.muted },
  verdict: {
    fontSize: 12,
    fontWeight: '800',
    borderWidth: 1.5,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  sample: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: ui.warnInk,
    backgroundColor: ui.warnBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
});

/** Accessible segmented control for small option sets. */
export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={props.label} style={segStyles.wrap}>
      <Text style={segStyles.label}>{props.label}</Text>
      <View style={segStyles.row}>
        {props.options.map((o) => {
          const selected = o.value === props.value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={o.label}
              onPress={() => props.onChange(o.value)}
              style={[segStyles.opt, selected && segStyles.optOn]}
            >
              <Text style={[segStyles.optText, selected && segStyles.optTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const segStyles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 12, color: ui.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  opt: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 10, borderWidth: 1.5, borderColor: ui.line, backgroundColor: ui.paper },
  optOn: { borderColor: ui.accent, backgroundColor: ui.soft },
  optText: { color: ui.ink, fontWeight: '600' },
  optTextOn: { color: ui.accent },
});

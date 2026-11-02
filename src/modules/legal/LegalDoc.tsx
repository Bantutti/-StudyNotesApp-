import { Text, View } from 'react-native';

import { useTheme } from '@/core/ui';

import { parseMarkdown, type Inline } from './markdown';

export function LegalDoc({ markdown, onOpenDoc }: { markdown: string; onOpenDoc: (id: string) => void }) {
  const th = useTheme();
  const spans = (inline: Inline[]) =>
    inline.map((s, i) => (
      <Text
        key={i}
        onPress={s.link ? () => onOpenDoc(s.link as string) : undefined}
        accessibilityRole={s.link ? 'link' : undefined}
        style={[s.bold && { fontWeight: '700' }, s.link ? { color: th.accentText, textDecorationLine: 'underline' } : null]}
      >
        {s.text}
      </Text>
    ));
  return (
    <View style={{ gap: th.space.s }}>
      {parseMarkdown(markdown).map((b, i) => {
        const base = { color: th.text, fontSize: th.type.body, lineHeight: th.type.body * 1.45 };
        switch (b.kind) {
          case 'heading':
            return (
              <Text key={i} accessibilityRole="header" style={{ color: th.text, fontWeight: '700', fontSize: b.level === 1 ? th.type.title : th.type.body + 2, marginTop: th.space.m }}>
                {spans(b.inline)}
              </Text>
            );
          case 'note':
            return (
              <View key={i} style={{ backgroundColor: th.surface, borderLeftWidth: 4, borderLeftColor: th.accentText, padding: th.space.s, borderRadius: th.radius.input }}>
                <Text style={base}>{spans(b.inline)}</Text>
              </View>
            );
          case 'bullet':
            return <Text key={i} style={[base, { paddingLeft: th.space.m }]}>{'\u2022 '}{spans(b.inline)}</Text>;
          case 'numbered':
            return <Text key={i} style={[base, { paddingLeft: th.space.m }]}>{`${b.n}. `}{spans(b.inline)}</Text>;
          default:
            return <Text key={i} style={base}>{spans(b.inline)}</Text>;
        }
      })}
    </View>
  );
}

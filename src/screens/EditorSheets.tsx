/**
 * Small bottom sheets used by the editor: the block menu (turn into, move,
 * duplicate, delete), the link editor, and Info (word count + outline).
 * Plain React Native Modals: no extra dependency, work in Expo Go.
 */
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { safeHref, t, type OutlineItem } from '@/core';
import { AppButton, BodyText, Caption, ListRow, SectionHeader, TextField, Title, useTheme, type IconName } from '@/core/ui';
import type { EditorCommand } from '@/modules/editor';

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const th = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={[styles.sheet, { backgroundColor: th.surface, borderTopLeftRadius: th.radius.sheet, borderTopRightRadius: th.radius.sheet }]}>
          <Title>{title}</Title>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const TURN_INTO: { cmd: EditorCommand; label: string; icon: IconName }[] = [
  { cmd: 'paragraph', label: 'Text', icon: 'text-outline' },
  { cmd: 'h1', label: 'Title', icon: 'text' },
  { cmd: 'h2', label: 'Heading', icon: 'reorder-two-outline' },
  { cmd: 'h3', label: 'Subheading', icon: 'remove-outline' },
  { cmd: 'bulletList', label: 'Bullet list', icon: 'list-outline' },
  { cmd: 'orderedList', label: 'Numbered list', icon: 'list-circle-outline' },
  { cmd: 'blockquote', label: 'Quote', icon: 'chatbox-ellipses-outline' },
  { cmd: 'callout', label: 'Callout', icon: 'alert-circle-outline' },
  { cmd: 'definition', label: 'Definition', icon: 'book-outline' },
  { cmd: 'summary', label: 'Summary', icon: 'document-text-outline' },
];

export function BlockMenuSheet({ visible, onClose, onCommand }: { visible: boolean; onClose: () => void; onCommand: (c: EditorCommand) => void }) {
  const run = (c: EditorCommand) => {
    onClose();
    onCommand(c);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="This block">
      <SectionHeader>Move and copy</SectionHeader>
      <ListRow icon="arrow-up-outline" title="Move up" onPress={() => run('moveBlockUp')} />
      <ListRow icon="arrow-down-outline" title="Move down" onPress={() => run('moveBlockDown')} />
      <ListRow icon="copy-outline" title="Duplicate" onPress={() => run('duplicateBlock')} />
      <SectionHeader>Turn into</SectionHeader>
      {TURN_INTO.map((t) => (
        <ListRow key={t.cmd} icon={t.icon} title={t.label} onPress={() => run(t.cmd)} />
      ))}
      <SectionHeader>Remove</SectionHeader>
      <ListRow icon="trash-outline" title="Delete block" destructive onPress={() => run('deleteBlock')} />
    </Sheet>
  );
}

export function LinkSheet({ visible, onClose, onApply, onRemove }: { visible: boolean; onClose: () => void; onApply: (href: string) => void; onRemove: () => void }) {
  const [href, setHref] = useState('https://');
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    const ok = safeHref(href);
    if (!ok || /\s/.test(ok)) return setError('Use a web address starting with https:// or http://, or mailto:.');
    setError(null);
    onApply(ok);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Link">
      <BodyText muted>{t('link.openTitle.hint')}</BodyText>
      <TextField label="Web address" value={href} onChangeText={setHref} autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={2000} error={error} />
      <AppButton label="Add link" onPress={apply} />
      <AppButton
        kind="secondary"
        label="Remove link"
        onPress={() => {
          onRemove();
          onClose();
        }}
      />
    </Sheet>
  );
}

export function InfoSheet(props: { visible: boolean; onClose: () => void; words: number; items: OutlineItem[]; onJump: (blockId: string) => void }) {
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title="Note info">
      <BodyText>{props.words === 1 ? '1 word' : `${props.words} words`}</BodyText>
      <SectionHeader>Outline</SectionHeader>
      {props.items.length === 0 ? <Caption>Headings you add show up here.</Caption> : null}
      {props.items.map((o, i) => (
        <ListRow
          key={`${o.blockId ?? 'h'}-${i}`}
          title={`${'  '.repeat(o.level - 1)}${o.text}`}
          onPress={() => {
            props.onClose();
            if (o.blockId) props.onJump(o.blockId);
          }}
        />
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { maxHeight: '80%', padding: 16, gap: 8 },
  body: { gap: 8, paddingBottom: 24 },
});

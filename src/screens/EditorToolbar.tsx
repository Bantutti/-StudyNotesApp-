/**
 * Toolbar above the keyboard (plan 9.4): Aa (text styles), highlight,
 * lists, + block, block menu, the P3b sparkle slot, toolbar actions
 * (Beautify), undo/redo, hide keyboard.
 *
 * Sparkle slot: always present (testID "editor-sparkle-slot") right after
 * the block menu. It renders every EditorAction registered with placement
 * 'sparkle' (P3b registers "ai" through composition) and shows nothing, and
 * takes no space, while none is registered. Both lists stay live: actions
 * registered while a note is open appear at once. A second row opens for the chosen
 * group. Table controls appear when the cursor is in a table.
 */
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, useTheme, type IconName } from '@/core/ui';
import type { EditorAction, EditorActionRegistry, EditorCommand, EditorState } from '@/modules/editor';

import { useEditorActions, type ActionAvailabilityContext } from './editorActionHooks';
import { highlighterColor, type StylePack } from '@/modules/stylepacks';

type Group = 'text' | 'highlight' | 'list' | null;

export interface EditorToolbarProps {
  state: EditorState | null;
  pack: StylePack;
  /** The app's action registry (services.editorActions). */
  registry: EditorActionRegistry;
  /** The open note, for EditorAction.isAvailable(). */
  actionContext?: ActionAvailabilityContext | null;
  busyAction: string | null;
  onCommand(name: EditorCommand, arg?: string): void;
  onAction(a: EditorAction): void;
  onBlockMenu(): void;
  onLink(): void;
}

function Tool(p: { icon?: IconName; label: string; text?: string; active?: boolean; disabled?: boolean; onPress: () => void; children?: ReactNode }) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.label}
      accessibilityState={{ selected: !!p.active, disabled: !!p.disabled }}
      disabled={p.disabled}
      onPress={p.onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.tool,
        { borderRadius: th.radius.chip, backgroundColor: p.active ? th.primary.fill : 'transparent' },
        (pressed || p.disabled) && styles.dim,
      ]}
    >
      {p.children ??
        (p.icon ? (
          <Icon name={p.icon} size={22} color={p.active ? th.primary.text : th.text} />
        ) : (
          <Text style={[styles.toolText, { color: p.active ? th.primary.text : th.text }]}>{p.text ?? p.label}</Text>
        ))}
    </Pressable>
  );
}

export function EditorToolbar(props: EditorToolbarProps) {
  const th = useTheme();
  const [group, setGroup] = useState<Group>(null);
  const s = props.state;
  const mark = (m: string) => !!s?.marks.includes(m as never);
  const block = s?.block ?? 'paragraph';
  const sparkle = useEditorActions(props.registry, 'sparkle', props.actionContext);
  const actions = useEditorActions(props.registry, 'toolbar', props.actionContext);
  const toggle = (g: Group) => setGroup((x) => (x === g ? null : g));
  const cmd = (name: EditorCommand, arg?: string) => props.onCommand(name, arg);

  return (
    <View style={[styles.wrap, { backgroundColor: th.surface, borderTopColor: th.line }]} accessibilityRole="toolbar">
      {s?.inTable ? (
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          <Tool label="Add row" text="+ Row" onPress={() => cmd('addRowAfter')} />
          <Tool label="Add column" text="+ Column" onPress={() => cmd('addColumnAfter')} />
          <Tool label="Delete row" text="− Row" onPress={() => cmd('deleteRow')} />
          <Tool label="Delete column" text="− Column" onPress={() => cmd('deleteColumn')} />
          <Tool label="Delete table" icon="trash-outline" onPress={() => cmd('deleteTable')} />
        </ScrollView>
      ) : null}
      {group === 'text' ? (
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          <Tool label="Title" text="H1" active={block === 'heading1'} onPress={() => cmd('h1')} />
          <Tool label="Heading" text="H2" active={block === 'heading2'} onPress={() => cmd('h2')} />
          <Tool label="Subheading" text="H3" active={block === 'heading3'} onPress={() => cmd('h3')} />
          <Tool label="Plain text" text="Text" active={block === 'paragraph'} onPress={() => cmd('paragraph')} />
          <Tool label="Bold" text="B" active={mark('bold')} onPress={() => cmd('bold')} />
          <Tool label="Italic" text="I" active={mark('italic')} onPress={() => cmd('italic')} />
          <Tool label="Underline" text="U" active={mark('underline')} onPress={() => cmd('underline')} />
          <Tool label="Strikethrough" text="S" active={mark('strike')} onPress={() => cmd('strike')} />
          <Tool label="Link" icon="link-outline" active={mark('link')} onPress={props.onLink} />
        </ScrollView>
      ) : null}
      {group === 'highlight' ? (
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {props.pack.highlighters.map((h, i) => (
            <Tool key={h.id} label={`Highlight: ${h.meaning || h.id}`} onPress={() => cmd('highlight', `k${i}`)}>
              <View style={[styles.swatch, { backgroundColor: highlighterColor(props.pack, i), borderColor: th.line }]} />
              <Text style={[styles.caption, { color: th.muted }]} numberOfLines={1}>
                {h.meaning}
              </Text>
            </Tool>
          ))}
          <Tool label="Remove highlight" icon="close-circle-outline" onPress={() => cmd('unhighlight')} />
        </ScrollView>
      ) : null}
      {group === 'list' ? (
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          <Tool label="Bullet list" icon="list-outline" active={block === 'bulletList'} onPress={() => cmd('bulletList')} />
          <Tool label="Numbered list" text="1." active={block === 'orderedList'} onPress={() => cmd('orderedList')} />
          <Tool label="Quote" icon="chatbox-ellipses-outline" active={block === 'blockquote'} onPress={() => cmd('blockquote')} />
          <Tool label="Callout" icon="alert-circle-outline" active={block === 'callout'} onPress={() => cmd('callout')} />
        </ScrollView>
      ) : null}
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Tool label="Text styles" text="Aa" active={group === 'text'} onPress={() => toggle('text')} />
        <Tool label="Highlight" icon="color-fill-outline" active={group === 'highlight' || mark('highlight')} onPress={() => toggle('highlight')} />
        <Tool label="Lists and quotes" icon="list-outline" active={group === 'list'} onPress={() => toggle('list')} />
        <Tool label="Insert a block" icon="add-circle-outline" onPress={() => cmd('blockPicker')} />
        <Tool label="Block menu: turn into, move, duplicate, delete" icon="reorder-three-outline" onPress={props.onBlockMenu} />
        <View testID="editor-sparkle-slot" style={sparkle.length ? styles.slot : styles.slotEmpty}>
          {sparkle.map((a) => (
            <Tool key={a.id} label={a.label} icon={a.icon as IconName} disabled={props.busyAction !== null} onPress={() => props.onAction(a)}>
              {props.busyAction === a.id ? <Text style={[styles.toolText, { color: th.primary.text }]}>…</Text> : undefined}
            </Tool>
          ))}
        </View>
        {actions.map((a) => (
          <Tool key={a.id} label={a.label} icon={a.icon as IconName} disabled={props.busyAction !== null} onPress={() => props.onAction(a)} />
        ))}
        <Tool label="Undo" icon="arrow-undo-outline" disabled={!s?.canUndo} onPress={() => cmd('undo')} />
        <Tool label="Redo" icon="arrow-redo-outline" disabled={!s?.canRedo} onPress={() => cmd('redo')} />
        <Tool label="Hide keyboard" icon="chevron-down-outline" onPress={() => cmd('blur')} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 4 },
  row: { gap: 4, paddingHorizontal: 6, alignItems: 'center' },
  tool: { minWidth: 44, minHeight: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  toolText: { fontSize: 16, fontWeight: '700' },
  dim: { opacity: 0.45 },
  slot: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  // Empty slot: no children and no layout box, so the toolbar has no gap.
  slotEmpty: { display: 'none' },
  swatch: { width: 26, height: 20, borderRadius: 5, borderWidth: 1 },
  caption: { fontSize: 10, maxWidth: 60 },
});

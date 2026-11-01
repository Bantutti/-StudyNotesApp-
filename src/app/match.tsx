/**
 * Match a look (plan F4, Flow 9; P5 M5). Pick 1-3 photos of notes you like
 * -> the on-device pass builds a matching look -> tweak it with the chips
 * and the slider -> save it as your own pack, and use it on this note, this
 * subject, or just keep it.
 *
 * Privacy: photos are cleaned and analysed on this phone and never kept
 * (lookmatch intake deletes every temporary copy). The result is pack DATA
 * only. Optional ?note=<id>: preview and apply on that note.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { applyPackToNote, cleanPackName, saveCustomPack, setSubjectPack, useAppData, useServices } from '@/composition';
import { SAMPLE_NOTE, userMessage, type NoteDoc } from '@/core';
import { AppButton, AppScreen, BodyText, Caption, Icon, SectionHeader, Spinner, Swatch, TextField, useTheme } from '@/core/ui';
import { PagePreview } from '@/modules/editor';
import {
  BLEND_STEPS,
  BlendStepper,
  blendPacks,
  buildPack,
  chipOptions,
  enumLabel,
  expoImagePorts,
  IntakeError,
  intakeMessage,
  pickFromLibrary,
  runMatch,
  takePhoto,
  type MatchChoices,
  type MatchResult,
  type PickOutcome,
} from '@/modules/lookmatch';
import type { Note } from '@/modules/store';
import type { FontFaceData, StylePack } from '@/modules/stylepacks';

type Phase = { kind: 'pick'; error?: string } | { kind: 'working'; label: string } | { kind: 'result'; match: MatchResult };

const PROGRESS: Record<string, string> = {
  cleaning: 'Cleaning your photos (removing location and camera data)…',
  reading: 'Reading the page…',
  pattern: 'Finding the paper…',
  palette: 'Picking the colours…',
  done: 'Building your look…',
};

/** Font faces for a pack that is not in the registry yet (the preview). */
function usePreviewFaces(pack: StylePack): FontFaceData[] {
  const { getFaces } = useServices();
  const [faces, setFaces] = useState<{ key: string; faces: FontFaceData[] } | null>(null);
  const key = `${pack.fonts.header}|${pack.fonts.body}`;
  useEffect(() => {
    let alive = true;
    getFaces(pack)
      .then((f) => alive && setFaces({ key, faces: f }))
      .catch(() => alive && setFaces({ key, faces: [] }));
    return () => {
      alive = false;
    };
  }, [getFaces, pack, key]);
  return faces && faces.key === key ? faces.faces : [];
}

/** One chip: a header row that opens its options. */
function Chip(props: { title: string; value: string; open: boolean; onToggle: () => void; children: React.ReactNode; testID?: string }) {
  const th = useTheme();
  return (
    <View style={[styles.chip, { borderColor: th.line, backgroundColor: th.surface, borderRadius: th.radius.card }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.open }}
        accessibilityLabel={`${props.title}: ${props.value}. Tap to change.`}
        onPress={props.onToggle}
        style={styles.chipHead}
        testID={props.testID}
      >
        <Text style={[styles.chipTitle, { color: th.muted }]}>{props.title}</Text>
        <Text style={[styles.chipValue, { color: th.text }]} numberOfLines={1}>
          {props.value}
        </Text>
        <Icon name={props.open ? 'chevron-up' : 'chevron-down'} size={18} color={th.muted} />
      </Pressable>
      {props.open ? <View style={styles.chipBody}>{props.children}</View> : null}
    </View>
  );
}

function Options<T extends string>(props: { values: readonly { value: T; label: string }[]; selected: T; onSelect: (v: T) => void }) {
  const th = useTheme();
  return (
    <View style={styles.wrapRow} accessibilityRole="radiogroup">
      {props.values.map((o) => {
        const sel = o.value === props.selected;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel }}
            onPress={() => props.onSelect(o.value)}
            style={[styles.option, { borderColor: sel ? th.accent : th.line, backgroundColor: sel ? th.bg : th.surface }]}
          >
            <Text style={{ color: sel ? th.accentText : th.text, fontWeight: sel ? '700' : '400' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Swatches(props: { colors: readonly { hex: string; source: string }[]; selected: string; onSelect: (hex: string) => void; what: string }) {
  return (
    <View style={styles.wrapRow} accessibilityRole="radiogroup">
      {props.colors.map((c) => (
        <Swatch
          key={c.hex}
          color={c.hex}
          selected={c.hex === props.selected}
          onPress={() => props.onSelect(c.hex)}
          label={`${props.what} ${c.hex}, ${c.source === 'photo' ? 'from your photo' : 'from the closest look'}`}
        />
      ))}
    </View>
  );
}

export default function MatchALook() {
  const { note: noteParam } = useLocalSearchParams<{ note?: string }>();
  const { store, bus } = useAppData();
  const { packs, randomBytes, logger } = useServices();
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const [note, setNote] = useState<Note | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!noteParam) return;
    let alive = true;
    store.notes.get(String(noteParam)).then((n) => alive && setNote(n && !n.deleted ? n : null));
    return () => {
      alive = false;
    };
  }, [store, noteParam]);
  useEffect(() => () => abort.current?.abort(), []);

  const start = async (pick: () => Promise<PickOutcome>) => {
    try {
      const outcome = await pick();
      if (outcome.kind === 'cancelled') return;
      if (outcome.kind === 'denied') {
        setPhase({ kind: 'pick', error: 'Camera access is off. You can allow it in Settings, or choose photos instead.' });
        return;
      }
      const ctl = new AbortController();
      abort.current = ctl;
      setPhase({ kind: 'working', label: PROGRESS.cleaning as string });
      const match = await runMatch({
        picked: outcome.images,
        ports: expoImagePorts,
        builtIns: packs.builtIn(),
        randomBytes,
        name: `My look ${packs.custom().length + 1}`,
        keepVisionCopies: false, // M6 turns this on when the vision pass is available
        signal: ctl.signal,
        onProgress: (p) => setPhase({ kind: 'working', label: PROGRESS[p.stage] ?? 'Working…' }),
      });
      if (!ctl.signal.aborted) setPhase({ kind: 'result', match });
    } catch (e) {
      if (e instanceof Error && e.message === 'cancelled') return setPhase({ kind: 'pick' });
      // Log the kind of problem only, never image data or paths.
      logger.warn('match.failed', { problem: e instanceof IntakeError ? e.problem : 'analysis' });
      setPhase({ kind: 'pick', error: e instanceof IntakeError ? intakeMessage(e) : "We couldn't read those photos. Try another photo or a screenshot." });
    }
  };

  if (phase.kind === 'pick') {
    return (
      <AppScreen>
        <BodyText>Pick 1 to 3 photos or screenshots of notes whose look you like. NotedPo matches the paper, colours and highlighters with one of its own looks.</BodyText>
        <Caption>Your photos are read on this phone. Location and camera details are removed, and the photos are not kept or uploaded. Only the look is saved.</Caption>
        <AppButton icon="images-outline" label="Choose photos" onPress={() => start(() => pickFromLibrary())} testID="match-library" />
        <AppButton kind="secondary" icon="camera-outline" label="Take a photo" onPress={() => start(takePhoto)} testID="match-camera" />
        {phase.error ? <BodyText>{phase.error}</BodyText> : null}
      </AppScreen>
    );
  }
  if (phase.kind === 'working') {
    return (
      <AppScreen>
        <Spinner />
        <BodyText center>{phase.label}</BodyText>
        <AppButton
          kind="plain"
          label="Cancel"
          onPress={() => {
            abort.current?.abort();
            setPhase({ kind: 'pick' });
          }}
        />
      </AppScreen>
    );
  }
  return (
    <MatchResultView
      match={phase.match}
      note={note}
      onRestart={() => setPhase({ kind: 'pick' })}
      onSave={async (pack, apply) => {
        try {
          const saved = await saveCustomPack(store, packs, pack);
          if (apply === 'note' && note) await applyPackToNote(store, note.id, saved.id);
          if (apply === 'subject' && note?.subject) {
            await setSubjectPack(store, note.subject, saved.id);
            await applyPackToNote(store, note.id, saved.id);
          }
          bus.emit();
          router.back();
        } catch (e) {
          Alert.alert('Match a look', userMessage(e));
        }
      }}
    />
  );
}

function MatchResultView(props: {
  match: MatchResult;
  note: Note | null;
  onRestart: () => void;
  onSave: (pack: StylePack, apply: 'note' | 'subject' | 'none') => Promise<void>;
}) {
  const { packs } = useServices();
  const { match, note } = props;
  const base = (match.ranked[0] as { pack: StylePack }).pack;
  const [choices, setChoices] = useState<MatchChoices>({});
  const [step, setStep] = useState(0);
  const [towardNote, setTowardNote] = useState(false);
  const [name, setName] = useState(match.matched.name);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => chipOptions(match.analysis, base, packs.builtIn()), [match.analysis, base, packs]);

  const notePack = note ? packs.getOrDefault(note.stylePackId) : null;
  const target = towardNote && notePack ? notePack : base;
  const matched = useMemo(() => buildPack({ id: match.id, name: match.matched.name, analysis: match.analysis, base, choices }), [match, base, choices]);
  const shown = useMemo(() => blendPacks(matched, target, step / (BLEND_STEPS - 1)), [matched, target, step]);
  const faces = usePreviewFaces(shown);
  const doc: NoteDoc = note?.document ?? SAMPLE_NOTE;
  const toggle = (k: string) => setOpen(open === k ? null : k);
  const choose = (patch: MatchChoices) => setChoices({ ...choices, ...patch });

  const save = async (apply: 'note' | 'subject' | 'none') => {
    let clean: string;
    try {
      clean = cleanPackName(name, matched.name);
    } catch (e) {
      Alert.alert('Name', userMessage(e));
      return;
    }
    setBusy(true);
    try {
      await props.onSave({ ...shown, name: clean }, apply);
    } finally {
      setBusy(false);
    }
  };

  const a = match.analysis;
  const keep = choices.keepHighlighters ?? a.highlighters.map(() => true);
  return (
    <AppScreen>
      <PagePreview doc={doc} pack={shown} faces={faces} height={260} zoom={0.6} label={`Your matched look on ${note ? 'this note' : 'a sample page'}`} />
      <Caption>
        Closest built-in look: {base.name}.{a.confidence.agreement < 1 ? ' Your photos did not all agree on the paper; check the Paper chip.' : ''}
      </Caption>

      <SectionHeader>How close to your photo</SectionHeader>
      <BlendStepper steps={BLEND_STEPS} value={step} onChange={setStep} leftLabel="Your photo" rightLabel={target.name} />
      {notePack && notePack.id !== base.id ? (
        <AppButton
          kind="plain"
          icon="swap-horizontal-outline"
          label={towardNote ? `Blend toward ${base.name} instead` : `Blend toward this note's look (${notePack.name})`}
          onPress={() => setTowardNote(!towardNote)}
        />
      ) : null}

      <SectionHeader>What we matched (tap to change)</SectionHeader>
      <Chip title="Paper" value={enumLabel(choices.paperType ?? a.paper.type)} open={open === 'type'} onToggle={() => toggle('type')} testID="chip-paper">
        <Options values={options.paperTypes.map((v) => ({ value: v, label: enumLabel(v) }))} selected={choices.paperType ?? a.paper.type} onSelect={(v) => choose({ paperType: v })} />
      </Chip>
      <Chip title="Paper colour" value={matched.paper.color} open={open === 'paper'} onToggle={() => toggle('paper')}>
        <Swatches what="Paper" colors={options.paperColors} selected={choices.paperColor ?? a.paper.color} onSelect={(hex) => choose({ paperColor: hex })} />
      </Chip>
      <Chip title="Ink" value={matched.palette.ink} open={open === 'ink'} onToggle={() => toggle('ink')}>
        <Swatches what="Ink" colors={options.inkColors} selected={choices.ink ?? a.ink} onSelect={(hex) => choose({ ink: hex })} />
      </Chip>
      <Chip title="Header colour" value={matched.palette.accent} open={open === 'accent'} onToggle={() => toggle('accent')}>
        <Swatches what="Header colour" colors={options.accentColors} selected={choices.accent ?? a.accent ?? base.palette.accent} onSelect={(hex) => choose({ accent: hex })} />
      </Chip>
      <Chip
        title="Highlighters"
        value={a.highlighters.length ? `${keep.filter(Boolean).length} of ${a.highlighters.length} from your photo` : `From ${base.name}`}
        open={open === 'hl'}
        onToggle={() => toggle('hl')}
      >
        {a.highlighters.length === 0 ? <Caption>{"No highlighters found in your photo, so the closest look's highlighters are used."}</Caption> : null}
        <View style={styles.wrapRow}>
          {a.highlighters.map((h, i) => (
            <Swatch
              key={`${h.seen}-${i}`}
              color={h.seen}
              selected={keep[i] !== false}
              label={`Highlighter ${i + 1}, ${keep[i] !== false ? 'kept' : 'left out'}`}
              onPress={() => {
                const next = [...keep];
                next[i] = !(keep[i] !== false);
                choose({ keepHighlighters: next });
              }}
            />
          ))}
        </View>
      </Chip>
      <Chip title="Fonts" value={options.fonts.find((f) => f.fonts.header === matched.fonts.header && f.fonts.body === matched.fonts.body)?.label ?? matched.fonts.header} open={open === 'fonts'} onToggle={() => toggle('fonts')}>
        <Options
          values={options.fonts.map((f) => ({ value: f.fromPack, label: f.label }))}
          selected={options.fonts.find((f) => f.fonts.header === matched.fonts.header && f.fonts.body === matched.fonts.body)?.fromPack ?? ''}
          onSelect={(id) => choose({ fonts: options.fonts.find((f) => f.fromPack === id)?.fonts })}
        />
      </Chip>
      <Chip title="Header style" value={enumLabel(matched.header.style)} open={open === 'header'} onToggle={() => toggle('header')}>
        <Options values={options.headerStyles} selected={matched.header.style} onSelect={(v) => choose({ headerStyle: v })} />
      </Chip>

      <TextField label="Name of your look" value={name} onChangeText={setName} maxLength={40} testID="match-name" />
      {note ? <AppButton icon="checkmark-circle-outline" label="Save and use on this note" onPress={() => save('note')} busy={busy} testID="match-save-note" /> : null}
      {note?.subject ? <AppButton kind="secondary" icon="albums-outline" label="Save and use for this subject" onPress={() => save('subject')} disabled={busy} /> : null}
      <AppButton kind={note ? 'secondary' : 'primary'} icon="bookmark-outline" label="Just save" onPress={() => save('none')} disabled={busy} testID="match-save" />
      <AppButton kind="plain" label="Try other photos" onPress={props.onRestart} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: StyleSheet.hairlineWidth },
  chipHead: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, minHeight: 48 },
  chipTitle: { fontSize: 13, fontWeight: '700', width: 104 },
  chipValue: { flex: 1, fontSize: 15 },
  chipBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderWidth: 1.5, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
});

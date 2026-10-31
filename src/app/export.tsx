import { useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { usePackFaces, useServices } from '@/composition';
import { userMessage } from '@/core';
import { Banner, Body, Button, Card, Row, SampleBadge, Screen, Segmented, Stat } from '@/core/ui';
import { MIME, type ExportFormat, type ExportOutput, type PaperSize } from '@/modules/export';
import { P0_PACK_IDS } from '@/modules/stylepacks';

const CHECKS = [
  'Fonts match the screen (header and body)',
  'Highlight colours match the screen',
  'Paper lines, grid or margin appear',
  'Definition and callout boxes look right',
  'No text cut off at page breaks',
  'Paper colour fills every page (dark pack)',
] as const;

export default function ExportSpike() {
  const { exporters, share, notes, results, packs, logger } = useServices();
  const [packId, setPackId] = useState<string>(P0_PACK_IDS[0]);
  const [paper, setPaper] = useState<PaperSize>('A4');
  const { pack, faces, missing, fontError } = usePackFaces(packId);
  const [out, setOut] = useState<Partial<Record<ExportFormat, ExportOutput>>>({});
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState('');
  const [checks, setChecks] = useState<boolean[]>(CHECKS.map(() => false));
  const [saved, setSaved] = useState('');
  const note = notes.get();

  const run = async (format: ExportFormat) => {
    if (!faces) return;
    setBusy(format);
    setError('');
    try {
      const r = await exporters[format].run({ doc: note.doc, pack, faces, title: note.title, paper });
      setOut((o) => ({ ...o, [format]: r }));
      if (r.uri && (format === 'pdf' || format === 'docx')) {
        await share.share(r.uri, MIME[format].mime, MIME[format].uti);
      }
    } catch (e) {
      logger.warn('export.failed', { format });
      setError(userMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const passed = checks.filter(Boolean).length;
    const ran = Boolean(out.pdf && out.docx);
    await results.record({
      spike: 'export',
      verdict: !ran ? 'info' : passed === CHECKS.length ? 'pass' : 'fail',
      summary: `PDF ${out.pdf?.ms ?? '-'} ms, DOCX ${out.docx?.ms ?? '-'} ms, visual checks ${passed}/${CHECKS.length} (${pack.id}, ${paper})`,
      metrics: {
        pack: pack.id,
        paper,
        pdf_ms: out.pdf?.ms ?? -1,
        pdf_kb: out.pdf?.bytes ? Math.round(out.pdf.bytes / 1024) : -1,
        docx_ms: out.docx?.ms ?? -1,
        docx_kb: out.docx?.bytes ? Math.round(out.docx.bytes / 1024) : -1,
        print_opened: Boolean(out.print),
        fonts_embedded: faces?.length ?? 0,
        checks_passed: passed,
        checks_total: CHECKS.length,
        ...Object.fromEntries(checks.map((c, i) => [`check_${i + 1}`, c])),
      },
    });
    setSaved('Saved to the results log.');
  };

  return (
    <Screen>
      {note.isSample ? <SampleBadge text="EXPORTING THE SAMPLE NOTE" /> : <Body muted>Exporting your edited note from the editor spike.</Body>}
      <Segmented label="Style pack" value={packId} options={P0_PACK_IDS.map((id) => ({ value: id, label: packs.get(id)?.name ?? id }))} onChange={setPackId} />
      <Segmented label="Paper" value={paper} options={[{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter / short bond' }]} onChange={setPaper} />
      <Body muted>
        Fonts: {faces === null ? 'loading…' : `${faces.length} bundled faces embedded`}
        {missing.length ? ` (not bundled in P0: ${missing.join(', ')})` : ''}
      </Body>
      {fontError ? <Banner>Fonts could not be loaded; exports will use system fonts.</Banner> : null}
      {error ? <Banner>{error}</Banner> : null}

      <Card title="Export">
        <Button label="Export PDF and share" busy={busy === 'pdf'} disabled={!faces || busy !== null} onPress={() => run('pdf')} />
        <Button label="Export DOCX and share" busy={busy === 'docx'} disabled={!faces || busy !== null} onPress={() => run('docx')} />
        <Button kind="secondary" label="Print…" busy={busy === 'print'} disabled={!faces || busy !== null} onPress={() => run('print')} />
        <Row>
          <Stat label="PDF" value={out.pdf ? `${out.pdf.ms} ms · ${Math.round((out.pdf.bytes ?? 0) / 1024)} KB` : '—'} />
          <Stat label="DOCX" value={out.docx ? `${out.docx.ms} ms · ${Math.round((out.docx.bytes ?? 0) / 1024)} KB` : '—'} />
        </Row>
      </Card>

      <Card title="Compare with the editor screen">
        <Body muted>Open each file (Files, Drive, Word or Docs) next to the editor spike and tick what matches.</Body>
        {CHECKS.map((c, i) => (
          <View key={c} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Switch
              value={checks[i]}
              onValueChange={(v) => setChecks((xs) => xs.map((x, j) => (j === i ? v : x)))}
              accessibilityLabel={c}
            />
            <Text style={{ flex: 1, color: '#2F3448' }}>{c}</Text>
          </View>
        ))}
        <Button label="Save result" onPress={save} />
        {saved ? <Body muted>{saved}</Body> : null}
      </Card>
    </Screen>
  );
}

/**
 * Me -> AI (Plan F5 / screens "Me and settings": manage or replace the AI
 * key, per-subject AI controls, consent screens).
 *
 * - Age status, and "Check again" once a re-check is available (§1.4).
 * - Per provider: masked key (maskKey only; the full key is never put in
 *   state), Test, Replace, Remove; consent status with Withdraw; usage today
 *   against the published limits and their check date; default provider.
 * - Subjects: "Never send to AI" switches (Subject.aiAllowed).
 * - Local reports: list and delete.
 * - Development builds only: the Demo AI switch.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { t } from '@/core';
import { AppButton, AppScreen, BodyText, Caption, SectionHeader, Surface, Title, useTheme } from '@/core/ui';
import { isAiError, maskKey, PROVIDER_CATALOG, PROVIDERS, type KeyVault, type Provider } from '@/modules/ai';

import type { AiUi } from '../create';
import { shortDate, usageText } from '../format';
import type { AgeStatus } from '../gate/gateStore';
import type { AiReport } from '../gate/reportsStore';
import type { AiScreenPorts } from '../ports';
import { AgeForm } from './AgeForm';
import { KeyForm } from './KeyForm';
import { ProviderFacts } from './KeyWizard';
import { Chip, Notice, Tag, ToggleRow } from './parts';
import { ta } from '../strings';

/** The subject switches need only this much of the store. */
export interface SubjectsPort {
  list(): Promise<{ id: string; name: string; aiAllowed: boolean; deleted: boolean }[]>;
  setAiAllowed(id: string, allowed: boolean): Promise<void>;
}

interface ProviderRow {
  id: Provider;
  masked: string | null;
  consentVersion: number | null;
  imageConsentVersion: number | null;
  usage: string;
  tokens: number;
}

export function AiSettingsScreen(props: { aiui: AiUi; keyVault: KeyVault; ports: AiScreenPorts; subjects: SubjectsPort; isDev: boolean }) {
  const th = useTheme();
  const { aiui, keyVault } = props;
  const [age, setAge] = useState<AgeStatus | null>(null);
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [def, setDef] = useState<Provider | null>(null);
  const [subjects, setSubjects] = useState<{ id: string; name: string; aiAllowed: boolean }[]>([]);
  const [reports, setReports] = useState<AiReport[]>([]);
  const [demo, setDemo] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [checkingAge, setCheckingAge] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Reload counter: every change bumps it, the effect below re-reads everything.
  const [rev, setRev] = useState(0);
  const load = useCallback(async () => setRev((r) => r + 1), []);

  /** Reads everything the screen shows (no state writes here). */
  const collect = useCallback(async () => {
    const engine = await aiui.activeEngine();
    const next = await Promise.all(
      PROVIDERS.map(async (id): Promise<ProviderRow> => {
        const key = await keyVault.get(id);
        const u = await engine.usage.today(id);
        const primary = PROVIDER_CATALOG[id].models.primary;
        return {
          id,
          masked: key ? maskKey(key) : null, // the raw key is dropped right here
          consentVersion: await aiui.gate.consentVersion(id, 'text'),
          imageConsentVersion: await aiui.gate.consentVersion(id, 'image'),
          usage: usageText({ provider: id, requests: u.requests, dailyLimit: u.limits[primary]?.rpd ?? null, remaining: u.remainingRequests, checkedOn: u.limitsCheckedOn }),
          tokens: u.inputTokens + u.outputTokens,
        };
      }),
    );
    const [a, d, list, reps, fake] = await Promise.all([aiui.gate.ageStatus(), aiui.gate.defaultProvider(), props.subjects.list(), aiui.reports.list(), aiui.gate.fakeMode()]);
    return { next, a, d, list, reps, fake };
  }, [aiui, keyVault, props.subjects]);

  useEffect(() => {
    let alive = true;
    collect().then(({ next, a, d, list, reps, fake }) => {
      if (!alive) return;
      setRows(next);
      setAge(a);
      setDef(d);
      setSubjects(list.filter((s) => !s.deleted));
      setReports(reps);
      setDemo(props.isDev && fake);
    });
    return () => {
      alive = false;
    };
  }, [collect, rev, props.isDev]);

  const test = async (p: Provider) => {
    setMessage(null);
    const label = PROVIDER_CATALOG[p].label;
    try {
      const r = await (await aiui.activeEngine()).testKey(p);
      setMessage(r.ok ? ta('ai.settings.keyOk', { provider: label }) : r.reason === 'missing_key' ? ta('ai.settings.noKey') : ta('ai.key.rejected', { provider: label }));
    } catch (e) {
      setMessage(isAiError(e) ? e.message : ta('ai.settings.testFailed'));
    }
  };

  const remove = (p: Provider) =>
    Alert.alert(ta('ai.settings.removeTitle', { provider: PROVIDER_CATALOG[p].label }), ta('ai.settings.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await keyVault.remove(p);
          await load();
        },
      },
    ]);

  return (
    <AppScreen>
      <Title>{ta('ai.settings.title')}</Title>
      {demo ? <Notice tone="warn">{ta('ai.demo.banner')}</Notice> : null}
      {message ? <Notice>{message}</Notice> : null}

      <SectionHeader>{ta('ai.settings.age')}</SectionHeader>
      <Surface>
        {age?.kind === 'adult' ? <BodyText>{ta('ai.settings.ageAdult', { date: shortDate(age.checkedAt) })}</BodyText> : null}
        {age?.kind === 'minor' ? <BodyText>{ta('ai.settings.ageMinor', { date: shortDate(age.checkedAt) })}</BodyText> : null}
        {age?.kind === 'unknown' ? <BodyText>{ta('ai.settings.ageUnknown')}</BodyText> : null}
        {age?.kind === 'unknown' && !checkingAge ? (
          <AppButton kind="secondary" label={ta('ai.settings.checkNow')} onPress={() => setCheckingAge(true)} testID="ai-settings-check-age" />
        ) : null}
        {age?.kind === 'minor' && age.recheckAvailable && !checkingAge ? (
          <AppButton
            kind="secondary"
            label={ta('ai.minor.recheck')}
            onPress={async () => {
              if (await aiui.gate.clearAgeForRecheck()) setCheckingAge(true);
            }}
          />
        ) : null}
        {checkingAge ? (
          <AgeForm
            onResult={async (adult) => {
              await aiui.gate.recordAge(adult);
              setCheckingAge(false);
              await load();
            }}
          />
        ) : null}
      </Surface>

      <SectionHeader>{ta('ai.settings.providers')}</SectionHeader>
      {rows.map((r) => {
        const info = PROVIDER_CATALOG[r.id];
        const consentCurrent = r.consentVersion === info.consent.version;
        return (
          <Surface key={r.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Title>{info.label}</Title>
              {def === r.id ? <Tag text={ta('ai.settings.default')} tone="accent" /> : null}
            </View>
            <BodyText>{r.masked ? ta('ai.settings.keyMasked', { masked: r.masked }) : ta('ai.settings.noKey')}</BodyText>
            <Caption>{r.usage}</Caption>
            <Caption>{ta('ai.settings.tokens', { n: r.tokens.toLocaleString('en-US'), date: info.freeTier.checkedOn })}</Caption>
            <AppButton kind="plain" label={ta('ai.settings.limitsPage', { provider: info.label })} onPress={() => props.ports.openLink(info.limitsUrl)} />
            {age?.kind !== 'adult' ? (
              // Stricter option (security review P3b-S8): no key can be added or tested before the 18+ check.
              <Caption>{ta('ai.settings.keysNeedAge')}</Caption>
            ) : editing === r.id ? (
              <KeyForm
                provider={r.id}
                clipboard={props.ports.clipboard}
                onSave={(raw, force) => aiui.saveKey(r.id, raw, force)}
                onSaved={() => {
                  setEditing(null);
                  void load();
                }}
              />
            ) : (
              <View style={{ gap: th.space.s }}>
                <AppButton kind="secondary" label={r.masked ? ta('ai.settings.replace') : ta('ai.settings.add')} onPress={() => setEditing(r.id)} testID={`ai-settings-edit-${r.id}`} />
                {r.masked ? <AppButton kind="secondary" label={ta('ai.settings.test')} onPress={() => void test(r.id)} testID={`ai-settings-test-${r.id}`} /> : null}
                {r.masked ? <AppButton kind="danger" label={ta('ai.settings.remove')} onPress={() => remove(r.id)} testID={`ai-settings-remove-${r.id}`} /> : null}
              </View>
            )}
            <BodyText>{consentCurrent ? ta('ai.settings.consentYes') : ta('ai.settings.consentNo')}</BodyText>
            {r.consentVersion !== null ? (
              <AppButton
                kind="secondary"
                label={ta('ai.settings.withdraw')}
                onPress={async () => {
                  await aiui.gate.withdrawConsent(r.id, 'text');
                  await load();
                }}
                testID={`ai-settings-withdraw-${r.id}`}
              />
            ) : null}
            {info.imageConsent ? (
              <BodyText>{r.imageConsentVersion === info.imageConsent.version ? ta('ai.settings.consentImageYes') : ta('ai.settings.consentImageNo')}</BodyText>
            ) : null}
            {info.imageConsent && r.imageConsentVersion !== null ? (
              <AppButton
                kind="secondary"
                label={ta('ai.settings.withdrawImage')}
                onPress={async () => {
                  await aiui.gate.withdrawConsent(r.id, 'image');
                  await load();
                }}
                testID={`ai-settings-withdraw-image-${r.id}`}
              />
            ) : null}
            <Chip
              label={ta('ai.settings.makeDefault')}
              selected={def === r.id}
              onPress={async () => {
                await aiui.gate.setDefaultProvider(r.id);
                await load();
              }}
            />
            <ProviderFacts provider={r.id} ports={props.ports} />
          </Surface>
        );
      })}

      <SectionHeader>{ta('ai.settings.subjects')}</SectionHeader>
      <Surface>
        <Caption>{ta('ai.settings.subjectsHint')}</Caption>
        {subjects.length === 0 ? <Caption>{ta('ai.settings.noSubjects')}</Caption> : null}
        {subjects.map((s) => (
          <ToggleRow
            key={s.id}
            label={ta('ai.settings.never', { name: s.name })}
            value={!s.aiAllowed}
            onChange={async (never) => {
              await props.subjects.setAiAllowed(s.id, !never);
              await load();
            }}
            testID={`ai-settings-subject-${s.id}`}
          />
        ))}
      </Surface>

      <SectionHeader>{ta('ai.settings.reports')}</SectionHeader>
      <Surface>
        <Caption>{ta('ai.report.local')}</Caption>
        {reports.length === 0 ? <Caption>{ta('ai.settings.noReports')}</Caption> : null}
        {reports.map((r) => (
          <View key={r.id} style={{ gap: th.space.xs }}>
            <BodyText>{`${shortDate(r.at)} · ${r.action} · ${PROVIDER_CATALOG[r.provider].label} · ${r.reason}`}</BodyText>
            {r.comment ? <Caption>{r.comment}</Caption> : null}
            <AppButton
              kind="plain"
              label={ta('ai.settings.deleteReport')}
              onPress={async () => {
                await aiui.reports.remove(r.id);
                await load();
              }}
            />
          </View>
        ))}
      </Surface>

      {props.isDev ? (
        <>
          <SectionHeader>{ta('ai.settings.developer')}</SectionHeader>
          <Surface>
            <ToggleRow
              label={ta('ai.demo.switch')}
              detail={ta('ai.demo.switchDetail')}
              value={demo}
              onChange={async (on) => {
                await aiui.gate.setFakeMode(on);
                await load();
              }}
              testID="ai-settings-demo"
            />
          </Surface>
        </>
      ) : null}

      <Caption>{ta('ai.settings.footer')}</Caption>
    </AppScreen>
  );
}

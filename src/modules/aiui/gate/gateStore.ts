/**
 * Gate store: the student's age answer and per-provider consent, kept in one
 * small JSON file on the phone (ai/gate.json, Q7 = A). ALGORITHMS §5.
 *
 * It implements the engine's AiGatePort, so the engine refuses to send unless
 * the answers stored HERE say yes (defence in depth, §3.1).
 *
 * Rules:
 * - Fail closed: an unreadable or invalid file means "no age, no consent".
 * - Only { adult, checkedAt } is kept for age: never the birth year.
 * - Consent is per provider, per DATA KIND (text, image) AND per version
 *   (Apple 5.1.2(i)). A text "yes" never authorises images (Lead, Nov 1).
 *   File v2; a v1 file (text consents only) is migrated, never widened.
 * - Never logs answers; logs only short event names.
 * - Device-local, never synced (it is not in the SQLite store that P2b syncs).
 */
import * as z from 'zod';

import type { Logger, TextFilePort } from '@/core';
import { CONSENT_KINDS, consentBlock, PROVIDERS, type AiGatePort, type ConsentKind, type Provider } from '@/modules/ai';

import { recheckDueAt } from './ageRule';

export const GATE_FILE_VERSION = 2;
/** Anything bigger than this is not a file we wrote (§5 "fail closed"). */
export const GATE_FILE_MAX_CHARS = 16_000;

const ms = z.number().int().min(0);
const consentSchema = z.strictObject({ version: z.number().int().min(1), at: ms });
const perProvider = z.partialRecord(z.enum(PROVIDERS), consentSchema);
const ageSchema = z.strictObject({ adult: z.boolean(), checkedAt: ms }).nullable();
const fileSchema = z.strictObject({
  v: z.literal(GATE_FILE_VERSION),
  age: ageSchema,
  /** One map per data kind: consents.text.groq, consents.image.groq, ... */
  consents: z.partialRecord(z.enum(CONSENT_KINDS), perProvider),
  defaultProvider: z.enum(PROVIDERS).nullable(),
  fakeMode: z.boolean(),
});
export type GateFile = z.infer<typeof fileSchema>;

/** v1 (P3b first build): consents were text only. Migrated as TEXT consents; never as image. */
const fileSchemaV1 = z.strictObject({
  v: z.literal(1),
  age: ageSchema,
  consents: perProvider,
  defaultProvider: z.enum(PROVIDERS).nullable(),
  fakeMode: z.boolean(),
});

function parseGateFile(json: unknown): GateFile | null {
  const v2 = fileSchema.safeParse(json);
  if (v2.success) return v2.data;
  const v1 = fileSchemaV1.safeParse(json);
  if (v1.success) return { ...v1.data, v: GATE_FILE_VERSION, consents: { text: v1.data.consents } };
  return null;
}

/** What the screens need to know about the age answer (§1.4). */
export type AgeStatus =
  | { kind: 'unknown' }
  | { kind: 'adult'; checkedAt: number }
  | { kind: 'minor'; checkedAt: number; recheckAvailable: boolean };

export interface GateStore extends AiGatePort {
  ageStatus(): Promise<AgeStatus>;
  /** Records the RESULT of the age check (the year itself is never passed in). */
  recordAge(adult: boolean): Promise<void>;
  /** Clears a minor answer so the age step can run again (only once re-check is available, §1.4). */
  clearAgeForRecheck(): Promise<boolean>;
  /** The engine's port (AiGatePort): true only for this provider, version AND kind. */
  hasConsent(provider: Provider, version: number, kind: ConsentKind): Promise<boolean>;
  consentVersion(provider: Provider, kind: ConsentKind): Promise<number | null>;
  giveConsent(provider: Provider, version: number, kind: ConsentKind): Promise<void>;
  withdrawConsent(provider: Provider, kind: ConsentKind): Promise<void>;
  defaultProvider(): Promise<Provider | null>;
  setDefaultProvider(provider: Provider | null): Promise<void>;
  /** Demo AI (fake provider) switch. The caller only honours it in development builds. */
  fakeMode(): Promise<boolean>;
  setFakeMode(on: boolean): Promise<void>;
  /** Delete all data: drop the in-memory copy (the file itself is removed with the ai folder). */
  forget(): void;
}

const empty = (): GateFile => ({ v: GATE_FILE_VERSION, age: null, consents: {}, defaultProvider: null, fakeMode: false });

export function createGateStore(deps: { file: TextFilePort; logger: Logger; now?: () => number }): GateStore {
  const now = deps.now ?? Date.now;
  const log = deps.logger.child('ai_gate');
  let cache: GateFile | null = null;
  // Serialise every read-modify-write so two quick answers can't overwrite each other (§5).
  let queue: Promise<unknown> = Promise.resolve();

  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  /** Loads once; anything wrong means the empty (fail-closed) state. */
  const load = async (): Promise<GateFile> => {
    if (cache) return cache;
    let parsed = empty();
    try {
      const raw = await deps.file.read();
      if (raw !== null) {
        if (raw.length > GATE_FILE_MAX_CHARS) log.warn('gate_file_reset', { reason: 'size' });
        else {
          const r = parseGateFile(JSON.parse(raw));
          if (r) parsed = r;
          else log.warn('gate_file_reset', { reason: 'schema' });
        }
      }
    } catch {
      log.warn('gate_file_reset', { reason: 'unreadable' });
    }
    cache = parsed;
    return parsed;
  };

  /** Applies a change to a COPY, writes it, then commits it to the cache. */
  const update = (change: (f: GateFile) => void): Promise<void> =>
    serial(async () => {
      const next = structuredCloneGate(await load());
      change(next);
      await deps.file.write(JSON.stringify(next)); // a failed write throws: the screen says "not saved"
      cache = next;
    });

  const read = <T>(pick: (f: GateFile) => T): Promise<T> => serial(async () => pick(await load()));

  return {
    // --- AiGatePort (read by the engine before every run) ------------------
    isAdultConfirmed: () => read((f) => f.age?.adult === true),
    hasConsent: (provider, version, kind) =>
      // A provider that never receives this kind (Mistral + image) can never have consent for it.
      read((f) => isKind(kind) && consentBlock(provider, kind) !== null && f.consents[kind]?.[provider]?.version === version),

    // --- Age ----------------------------------------------------------------
    ageStatus: () =>
      read((f): AgeStatus => {
        if (!f.age) return { kind: 'unknown' };
        if (f.age.adult) return { kind: 'adult', checkedAt: f.age.checkedAt };
        return { kind: 'minor', checkedAt: f.age.checkedAt, recheckAvailable: now() >= recheckDueAt(f.age.checkedAt) };
      }),
    recordAge: async (adult) => {
      await update((f) => {
        f.age = { adult, checkedAt: now() };
      });
      log.info('age_recorded'); // never the answer, never the year
    },
    clearAgeForRecheck: async () => {
      const f = await read((x) => x);
      if (!f.age || f.age.adult || now() < recheckDueAt(f.age.checkedAt)) return false;
      await update((x) => {
        x.age = null;
      });
      return true;
    },

    // --- Consent --------------------------------------------------------------
    consentVersion: (provider, kind) => read((f) => (isKind(kind) ? (f.consents[kind]?.[provider]?.version ?? null) : null)),
    giveConsent: async (provider, version, kind) => {
      if (!Number.isInteger(version) || version < 1) throw new Error('bad_consent_version');
      if (!isKind(kind)) throw new Error('bad_consent_kind');
      if (consentBlock(provider, kind) === null) throw new Error('kind_not_supported'); // e.g. photos to Mistral
      await update((f) => {
        (f.consents[kind] ??= {})[provider] = { version, at: now() };
      });
      log.info('consent_given', { provider, version, kind });
    },
    withdrawConsent: async (provider, kind) => {
      if (!isKind(kind)) throw new Error('bad_consent_kind');
      await update((f) => {
        delete f.consents[kind]?.[provider];
      });
      log.info('consent_withdrawn', { provider, kind });
    },

    // --- Preferences ------------------------------------------------------------
    defaultProvider: () => read((f) => f.defaultProvider),
    setDefaultProvider: (provider) =>
      update((f) => {
        f.defaultProvider = provider;
      }),
    fakeMode: () => read((f) => f.fakeMode),
    setFakeMode: (on) =>
      update((f) => {
        f.fakeMode = on;
      }),

    forget: () => {
      cache = null;
    },
  };
}

/** Runtime check (callers in plain JS or a typo must not widen consent). */
function isKind(k: unknown): k is ConsentKind {
  return typeof k === 'string' && (CONSENT_KINDS as readonly string[]).includes(k);
}

/** Deep copy of the (small, JSON-only) gate file. */
function structuredCloneGate(f: GateFile): GateFile {
  return JSON.parse(JSON.stringify(f)) as GateFile;
}

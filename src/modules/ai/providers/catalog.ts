/**
 * Provider catalog: everything P3b's key wizard and usage meter show about a
 * provider, as data (no UI here).
 *
 * Facts were read on the providers' official pages on 2026-11-01 and are
 * dated (`checkedOn`) because free tiers change (Plan §20 risk). P7 must
 * re-check them before launch. Docs and terms URLs below were opened on that date;
 * where a console page could not be verified, the matching docs page is used.
 *
 * Decisions (Rey, Nov 1):
 * - Q1 = A: AI is an 18+ feature. Every provider here requires 18+ in its
 *   terms, so `minAge` is 18 and the wizard asks "I'm 18 or older".
 * - Q2 = A: Mistral is provider #2, and the wizard tells users to turn off
 *   training in Mistral's privacy settings (Admin panel, API, Privacy).
 * - Q3 = A: Groq uses gpt-oss-120b, falling back to gpt-oss-20b (limits are
 *   counted per model, so the fallback doubles the daily allowance).
 */
import type { Provider } from '../keyFormat';
import { PROVIDER_INFO } from '../keyFormat';

/** Published free limits for one model. null = not published. */
export interface ModelLimits {
  rpm: number | null; // requests per minute
  rpd: number | null; // requests per day
  tpm: number | null; // tokens per minute (input + output)
  tpd: number | null; // tokens per day
}

export interface ProviderInfo {
  id: Provider;
  label: string;
  /** Fixed HTTPS API base. The only host the key is ever sent to. */
  apiBase: string;
  keyUrl: string;
  limitsUrl: string;
  privacyUrl: string;
  termsUrl: string;
  /** Minimum age in the provider's terms. */
  minAge: number;
  /** One-line summary of each provider's age rule, for the wizard. */
  ageRule: string;
  dataUse: {
    /** True when the free tier may use prompts to train or improve models by default. */
    mayTrainOnFreeTier: boolean;
    summary: string;
    /** What the user should do to protect their notes, or null when nothing is needed. */
    privacyStep: string | null;
  };
  capabilities: {
    text: boolean;
    /** How we get structured output: strict = constrained decoding guarantees the schema. */
    structuredOutput: 'strict' | 'schema';
    vision: boolean;
    transcription: boolean;
  };
  models: {
    primary: string;
    /** Tried once when the primary model is rate limited (not auto-retried). */
    fallbacks: string[];
  };
  freeTier: {
    isFree: true;
    needsCard: boolean;
    /** Limits per model id; models missing here have unpublished limits. */
    limits: Record<string, ModelLimits>;
    note: string;
    checkedOn: string; // ISO date
    sourceUrl: string;
  };
  /** What costs money, in one sentence. */
  paidNote: string;
}

const GROQ_FREE_CHAT: ModelLimits = { rpm: 30, rpd: 1_000, tpm: 8_000, tpd: 200_000 };

export const PROVIDER_CATALOG: Record<Provider, ProviderInfo> = {
  groq: {
    id: 'groq',
    label: PROVIDER_INFO.groq.label,
    apiBase: 'https://api.groq.com/openai/v1',
    keyUrl: PROVIDER_INFO.groq.keyUrl,
    limitsUrl: 'https://console.groq.com/docs/rate-limits',
    privacyUrl: 'https://console.groq.com/docs/your-data',
    termsUrl: 'https://console.groq.com/docs/legal/services-agreement',
    minAge: 18,
    ageRule: "Groq's terms say you must be 18 or older to use its service.",
    dataUse: {
      mayTrainOnFreeTier: false,
      summary:
        "Groq doesn't keep your requests by default. It may keep them for up to 30 days only to fix outages or check for abuse.",
      privacyStep: "Optional: turn on Zero Data Retention in Groq's Data Controls settings.",
    },
    capabilities: { text: true, structuredOutput: 'strict', vision: false, transcription: true },
    models: { primary: 'openai/gpt-oss-120b', fallbacks: ['openai/gpt-oss-20b'] },
    freeTier: {
      isFree: true,
      needsCard: false,
      limits: {
        'openai/gpt-oss-120b': GROQ_FREE_CHAT,
        'openai/gpt-oss-20b': GROQ_FREE_CHAT,
      },
      note: 'Free plan: about 1,000 AI requests a day per model. Your exact limits are on your Groq Limits page.',
      checkedOn: '2026-11-01',
      sourceUrl: 'https://console.groq.com/docs/rate-limits',
    },
    paidNote: 'The free plan costs nothing. Only upgrading to the Developer plan (pay per token) costs money.',
  },
  mistral: {
    id: 'mistral',
    label: PROVIDER_INFO.mistral.label,
    apiBase: 'https://api.mistral.ai/v1',
    keyUrl: PROVIDER_INFO.mistral.keyUrl,
    limitsUrl: 'https://docs.mistral.ai/admin/billing-usage/usage-limits',
    privacyUrl: 'https://docs.mistral.ai/admin/monitor-comply/privacy-data-controls',
    termsUrl: 'https://legal.mistral.ai/terms/commercial-terms-of-service/',
    minAge: 18,
    ageRule:
      "Mistral's API is meant for business use, and minors may use it only with a parent's or guardian's consent. This app allows AI for people 18 and older.",
    dataUse: {
      mayTrainOnFreeTier: true,
      summary: 'On the free plan, Mistral may use what you send to train its models unless you turn this off.',
      privacyStep: "Turn off training: in Mistral's Admin panel, open API, then Privacy, and switch off the data-usage (training) toggle.",
    },
    capabilities: { text: true, structuredOutput: 'schema', vision: false, transcription: false },
    models: { primary: 'mistral-small-latest', fallbacks: [] },
    freeTier: {
      isFree: true,
      needsCard: false,
      limits: {},
      note: "Free mode includes monthly usage. Mistral doesn't publish the numbers; they are on your Limits page.",
      checkedOn: '2026-11-01',
      sourceUrl: 'https://docs.mistral.ai/admin/billing-usage/usage-limits',
    },
    paidNote: 'Free mode costs nothing. Only pay-as-you-go usage beyond the included amount costs money.',
  },
};

export function providerInfo(id: Provider): ProviderInfo {
  return PROVIDER_CATALOG[id];
}

/** Every model a provider may use, primary first. */
export function providerModels(id: Provider): string[] {
  const m = PROVIDER_CATALOG[id].models;
  return [m.primary, ...m.fallbacks];
}

/** Published TPM for a model, or null. Feeds the pacer (ALGORITHMS §2). */
export function modelTpm(id: Provider, model: string): number | null {
  return PROVIDER_CATALOG[id].freeTier.limits[model]?.tpm ?? null;
}

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
 *   training. Path updated per the Lead (Nov 1): Admin panel -> Privacy ->
 *   "Anonymous improvement data" (Mistral Help Center article dated 2026-09-03).
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
    /** Where privacyStep comes from (official page and its date), for the wizard's "Learn more". */
    privacyStepSource: { url: string; dated: string } | null;
  };
  /**
   * Consent-screen data (Plan F5 "the first send to each provider shows a
   * consent screen"; Apple App Review Guideline 5.1.2(i): disclose where
   * personal data goes, including third-party AI, and get explicit permission).
   * The engine refuses to send until the gate reports a "yes" for THIS
   * provider AND THIS version (AiGatePort.hasConsent(provider, version)).
   */
  consent: ConsentBlock;
  /**
   * P3b (Lead, Nov 1; Rey approved P5's "Match a look" photo feature): a
   * SEPARATE consent for sending photos. A photo is a different data type
   * from note text, so a text "yes" never authorises images (and vice versa).
   * null = this provider is never sent photos (Rey: Groq only for images).
   */
  imageConsent: ConsentBlock | null;
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
    /** Model that reads images (P5 Match a look), or null when the provider is never sent photos. */
    vision: string | null;
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

/** What a consent screen shows and the gate versions (one per provider and data kind). */
export interface ConsentBlock {
  /** Always true: an explicit per-provider "yes" is required before the first send. */
  required: true;
  /** Bump whenever recipient/dataSent/purpose/dataUse wording changes; older "yes" answers stop counting. */
  version: number;
  /** Who receives the data, as named on the screen. */
  recipient: string;
  /** Exactly what leaves the device. */
  dataSent: string;
  /** Why it is sent. */
  purpose: string;
}

/** The kinds of data a student consents to separately (P3b; P4 adds 'audio' the same way). */
export const CONSENT_KINDS = ['text', 'image'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

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
      privacyStepSource: { url: 'https://console.groq.com/docs/your-data', dated: '2026-11-01' },
    },
    consent: {
      required: true,
      version: 1,
      recipient: 'Groq (GroqCloud, servers in the United States)',
      dataSent: 'The text of the note blocks you chose (your selection or the whole note) and your Groq API key. Nothing else from the app.',
      purpose: 'To run the AI action you picked and send the result back to this phone for you to review.',
    },
    imageConsent: {
      required: true,
      version: 1,
      recipient: 'Groq (GroqCloud, servers in the United States)',
      dataSent: 'The reference photos you picked for matching a look, and your Groq API key. Nothing else from the app: no notes.',
      purpose: 'To describe the look of your photos (colours, paper, headings, layout) so the app can suggest a matching style pack for you to review.',
    },
    // P5: Groq reads photos for Match a look (Rey, Nov 1) with qwen/qwen3.8-27b: images and strict
    // JSON schema output (console.groq.com/docs/vision and /docs/structured-outputs, read 2026-11-01).
    capabilities: { text: true, structuredOutput: 'strict', vision: true, transcription: true },
    models: { primary: 'openai/gpt-oss-120b', fallbacks: ['openai/gpt-oss-20b'], vision: 'qwen/qwen3.8-27b' },
    freeTier: {
      isFree: true,
      needsCard: false,
      limits: {
        'openai/gpt-oss-120b': GROQ_FREE_CHAT,
        'openai/gpt-oss-20b': GROQ_FREE_CHAT,
        // Same free plan limits (P3a's 2026-11-01 check). Each image counts as 2,048 input tokens.
        'qwen/qwen3.8-27b': GROQ_FREE_CHAT,
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
      // Path per Mistral Help Center, "Can I opt out of my input or output data
      // being used for training?" (dated 2026-09-03, re-checked 2026-11-01).
      // The API toggle is separate from the one for Mistral's Vibe product.
      privacyStep:
        "Turn off training: in Mistral's Admin panel, open Privacy in the left-hand menu and switch off \"Anonymous improvement data\". This is separate from the Vibe training toggle, so turning off one does not turn off the other.",
      privacyStepSource: {
        url: 'https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training',
        dated: '2026-09-03',
      },
    },
    consent: {
      required: true,
      version: 1,
      recipient: 'Mistral AI',
      dataSent: 'The text of the note blocks you chose (your selection or the whole note) and your Mistral API key. Nothing else from the app.',
      purpose: 'To run the AI action you picked and send the result back to this phone for you to review.',
    },
    // Photos go to Groq only (Rey, Nov 1). Mistral is never sent images.
    imageConsent: null,
    capabilities: { text: true, structuredOutput: 'schema', vision: false, transcription: false },
    models: { primary: 'mistral-small-latest', fallbacks: [], vision: null },
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

/** The consent block for one provider and data kind, or null when that provider never receives that kind. */
export function consentBlock(id: Provider, kind: ConsentKind): ConsentBlock | null {
  return kind === 'image' ? PROVIDER_CATALOG[id].imageConsent : PROVIDER_CATALOG[id].consent;
}

/** Providers that may receive a data kind (image: Groq only). */
export function providersFor(kind: ConsentKind): Provider[] {
  return (Object.keys(PROVIDER_CATALOG) as Provider[]).filter((p) => consentBlock(p, kind) !== null);
}

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

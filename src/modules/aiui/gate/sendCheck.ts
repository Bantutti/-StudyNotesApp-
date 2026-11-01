/**
 * The one check every send to an AI provider must pass, for any data kind
 * (ALGORITHMS §5.1). The note-text flow uses it through the engine's gate;
 * P5's optional vision pass calls it with kind 'image' before sending a photo.
 *
 *   subject switch (when given) -> 18+ answer -> consent for THIS provider,
 *   THIS kind and the catalog's CURRENT version for that kind
 *
 * A text consent never authorises images, and an older version never counts.
 * Pure: reads the gate, sends nothing, logs nothing.
 */
import { AiError, consentBlock, PROVIDER_CATALOG, type ConsentKind, type Provider } from '@/modules/ai';

import type { GateStore } from './gateStore';

export interface SendRequest {
  provider: Provider;
  kind: ConsentKind;
  /** The subject's "AI allowed" switch, when the data belongs to a subject (notes). Omit for photos. */
  aiAllowed?: boolean;
}

export type SendCheck = { ok: true; consentVersion: number } | { ok: false; error: AiError };

export async function checkCanSend(gate: GateStore, req: SendRequest): Promise<SendCheck> {
  const label = { providerLabel: PROVIDER_CATALOG[req.provider].label };
  if (req.aiAllowed === false) return { ok: false, error: new AiError('blocked', label) };
  if (!(await gate.isAdultConfirmed())) return { ok: false, error: new AiError('age_required', label) };
  const version = consentBlock(req.provider, req.kind).version;
  if (!(await gate.hasConsent(req.provider, version, req.kind))) return { ok: false, error: new AiError('consent_required', label) };
  return { ok: true, consentVersion: version };
}

/** Same as checkCanSend, but throws the AiError (for callers that prefer exceptions). */
export async function assertCanSend(gate: GateStore, req: SendRequest): Promise<void> {
  const r = await checkCanSend(gate, req);
  if (!r.ok) throw r.error;
}

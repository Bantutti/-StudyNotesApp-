/**
 * Redaction rules for anything that may reach a log sink.
 *
 * Two layers:
 * 1. Field names that suggest secrets or user content are dropped entirely.
 * 2. String values are scrubbed for known secret shapes and truncated.
 */

const SENSITIVE_FIELD =
  /(key|token|secret|passw|auth|cookie|session|text|content|body|transcript|note|html|prompt|email|phone|name|uri|url|path|title|term|query|search|snippet|preview|tag|href|link|question|answer|front|back|label|caption)/i;

const SECRET_SHAPES: readonly RegExp[] = [
  /gsk_[A-Za-z0-9]{8,}/g, // Groq
  /sk-[A-Za-z0-9_-]{8,}/g, // OpenAI-style
  /AIza[0-9A-Za-z_-]{20,}/g, // Google / Firebase
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /[A-Za-z0-9+/]{64,}={0,2}/g, // long base64 blobs (audio, fonts, keys)
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // email addresses
];

export const MAX_LOG_STRING = 120;

export function isSensitiveField(name: string): boolean {
  return SENSITIVE_FIELD.test(name);
}

export function scrubString(value: string): string {
  let out = value;
  for (const re of SECRET_SHAPES) out = out.replace(re, '[redacted]');
  if (out.length > MAX_LOG_STRING) out = `${out.slice(0, MAX_LOG_STRING)}…`;
  return out;
}

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Readonly<Record<string, LogValue>>;

export function redactFields(fields: LogFields | undefined): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    if (isSensitiveField(k)) {
      out[k] = '[redacted]';
    } else if (typeof v === 'string') {
      out[k] = scrubString(v);
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) {
      out[k] = v;
    } else {
      out[k] = '[dropped]'; // objects never reach sinks
    }
  }
  return out;
}

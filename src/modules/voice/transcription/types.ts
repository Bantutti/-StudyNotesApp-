/** Provider-neutral transcription contract (Groq today; others are adapters). */
export interface TranscriptionRequest {
  fileUri: string;
  fileName: string; // app-generated, e.g. rec-20261101T101500.m4a
  mimeType: 'audio/m4a' | 'audio/mp4' | 'audio/mpeg' | 'audio/wav' | 'audio/webm';
  /** ISO-639-1 or '' for auto-detect. */
  language: '' | 'en' | 'tl';
  /** Spelling hint (subject glossary). Trimmed to MAX_PROMPT_CHARS. */
  prompt?: string;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  language: string;
  durationSec: number;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
  /** Wall time of the API call. */
  latencyMs: number;
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly maxUploadBytes: number;
  transcribe(req: TranscriptionRequest): Promise<Transcript>;
  /** Cheap authenticated call to confirm the key works. */
  testKey(): Promise<boolean>;
}

export const MAX_PROMPT_CHARS = 800; // ~224 tokens, Whisper's prompt limit

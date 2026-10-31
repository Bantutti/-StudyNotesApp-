import { createLogger, memorySink } from '../logger';
import { redactFields, scrubString } from '../redact';

describe('redaction', () => {
  it('drops fields whose names suggest secrets or user content', () => {
    const out = redactFields({ apiKey: 'x', text: 'my note', transcript: 'hi', ms: 12, ok: true });
    expect(out).toEqual({ apiKey: '[redacted]', text: '[redacted]', transcript: '[redacted]', ms: 12, ok: true });
  });

  it('scrubs secret shapes inside innocent-looking fields', () => {
    expect(scrubString('code gsk_abcdefghijklmnopqrstuvwxyz123456 end')).toBe('code [redacted] end');
    expect(scrubString('Bearer abc.def.ghi')).toBe('[redacted]');
    expect(scrubString('AIzaSyA-1234567890abcdefghijklmnopqrs')).toBe('[redacted]');
    expect(scrubString('mail rey@example.com now')).toBe('mail [redacted] now');
    expect(scrubString('A'.repeat(80))).toBe('[redacted]');
  });

  it('truncates long strings', () => {
    expect(scrubString('word '.repeat(60)).length).toBeLessThanOrEqual(121);
  });

  it('never forwards objects to the sink', () => {
    const sink = memorySink();
    const log = createLogger({ sink, minLevel: 'debug' });
    log.info('test.event', { status: 401, detail: { key: 'gsk_secret' } as unknown as string });
    expect(sink.records[0]?.fields).toEqual({ status: 401, detail: '[dropped]' });
  });

  it('rejects free-text event names and respects level', () => {
    const sink = memorySink();
    const log = createLogger({ sink, minLevel: 'info' });
    log.debug('hidden');
    log.warn('Some free text with gsk_secret');
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.event).toBe('invalid_event_name');
  });

  it('child loggers extend scope', () => {
    const sink = memorySink();
    createLogger({ sink }).child('voice').child('groq').info('ok');
    expect(sink.records[0]?.scope).toBe('app.voice.groq');
  });
});

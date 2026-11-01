import { errorCode } from '@/core';
import { AiError } from '@/modules/ai';

describe('core error codes added for P3a (docs/phases/P3a/MERGE_NOTES.md §1)', () => {
  it('maps AI cancel and consent to the new core codes', () => {
    expect(errorCode(new AiError('cancelled'))).toBe('cancelled');
    expect(errorCode(new AiError('consent_required', { providerLabel: 'Groq' }))).toBe('consent');
    expect(errorCode(new AiError('age_required'))).toBe('permission_denied');
    expect(errorCode(new AiError('blocked'))).toBe('permission_denied');
  });
});

/**
 * Test-then-save for a pasted key (key wizard and AI settings share it).
 *
 * Order: format check -> Test key with the CANDIDATE (not stored yet) ->
 * store in secure storage only if the provider accepted it. So a mistyped or
 * revoked key never replaces a working one. If the key can't be checked
 * (offline, timeout, provider down), the student may choose "Save anyway".
 *
 * The key is only ever an argument here: never returned, logged or kept.
 */
import { AppError, type Logger } from '@/core';
import { isAiError, normalizeKey, type AiEngine, type KeyVault, type Provider } from '@/modules/ai';

import type { SaveKeyResult } from './types';

export async function testAndSaveKey(
  deps: { engine: AiEngine; keyVault: KeyVault; logger: Logger },
  provider: Provider,
  raw: string,
  force = false,
): Promise<SaveKeyResult> {
  const n = normalizeKey(provider, raw);
  if (!n.ok) return { kind: 'bad_format', message: n.error.message };
  const key = n.value;
  if (!force) {
    try {
      const r = await deps.engine.testKey(provider, undefined, key);
      if (!r.ok) {
        deps.logger.info('key_rejected', { provider });
        return { kind: 'rejected' };
      }
    } catch (e) {
      // Not a verdict on the key: the check itself failed. The message names the provider, no content.
      return { kind: 'unchecked', message: isAiError(e) ? e.message : 'The key could not be checked right now.' };
    }
  }
  try {
    await deps.keyVault.set(provider, key); // Keychain / Keystore only
  } catch (e) {
    if (e instanceof AppError) return { kind: 'bad_format', message: e.message };
    return { kind: 'unchecked', message: 'The key could not be saved on this phone. Try again.' };
  }
  deps.logger.info('key_saved', { provider, checked: !force });
  return { kind: 'saved' };
}

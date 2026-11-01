/**
 * Custom pack ids: "ref-" + 20 characters of lowercase base32 (RFC 4648
 * alphabet a-z, 2-7), i.e. 100 random bits from the app's CSPRNG
 * (expo-crypto, injected). The same string is:
 *   - a valid pack id (stylepacks schema: /^[a-z0-9][a-z0-9-]{1,40}$/, and
 *     CUSTOM_PACK_ID /^ref-[a-z2-7]{20}$/, which the registry requires),
 *   - a valid P2a entity id (/^[A-Za-z0-9_-]{16,64}$/, at least 80 random bits),
 * so one id names the pack, its local stylePacks row and its cloud document.
 */
import type { RandomBytes } from '@/core';

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function newCustomPackId(randomBytes: RandomBytes): string {
  const bytes = randomBytes(13); // 104 bits; we use the first 100
  if (bytes.length < 13) throw new Error('random_too_short');
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 20) {
      out += B32[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1; // keep only the unused low bits
  }
  return `ref-${out}`;
}

/**
 * Punycode (RFC 3492) for showing internationalized host names safely in the
 * link confirm dialog: "bücher.example" is shown as "xn--bcher-kva.example",
 * so look-alike letters from other scripts can't pass for a familiar domain.
 * Encoding only, pure, no dependencies (React Native's URL can't parse hosts).
 */
const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

const digit = (d: number): string => String.fromCharCode(d + (d < 26 ? 97 : 22)); // a-z, 0-9

function adapt(delta: number, points: number, first: boolean): number {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

/** Encodes one label's code points (no "xn--" prefix). */
export function punycodeEncode(label: string): string {
  const cps = Array.from(label, (c) => c.codePointAt(0) as number);
  let out = cps.filter((c) => c < 0x80).map((c) => String.fromCharCode(c)).join('');
  const basic = out.length;
  let handled = basic;
  if (basic > 0) out += '-';
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < cps.length) {
    const m = Math.min(...cps.filter((c) => c >= n));
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of cps) {
      if (c < n) delta += 1;
      if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
          if (q < t) break;
          out += digit(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        out += digit(q);
        bias = adapt(delta, handled + 1, handled === basic);
        delta = 0;
        handled += 1;
      }
    }
    delta += 1;
    n += 1;
  }
  return out;
}

/** A host as browsers resolve it (close to UTS 46): NFKC, lowercase, IDN labels as "xn--…", Unicode dots as ".". */
export function toAsciiHost(host: string): string {
  let h = host;
  try {
    h = host.normalize('NFKC');
  } catch {
    // An engine without Unicode normalization still gets punycode for any non-ASCII label.
  }
  return h
    .toLowerCase()
    .split(/[.\u3002\uFF0E\uFF61]/)
    .map((label) => (/^[\x00-\x7F]*$/.test(label) ? label : `xn--${punycodeEncode(label)}`))
    .join('.');
}

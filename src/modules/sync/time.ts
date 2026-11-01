/**
 * Cloud timestamps without the Firebase SDK.
 *
 * Firestore stores server times with MICROSECOND precision, while the local
 * database keeps milliseconds. Pull cursors therefore keep seconds + nanos
 * exactly (Key Considerations 2), and local rows get toMillis().
 */
import type { TimestampLike } from './cloudSchemas';

/** A Firestore-compatible timestamp (duck-typed like P2a's TimestampLike). */
export class CloudTime implements TimestampLike {
  constructor(
    readonly seconds: number,
    readonly nanoseconds: number,
  ) {
    if (!Number.isInteger(seconds) || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds > 999_999_999) {
      throw new RangeError('bad_timestamp');
    }
  }

  static fromMillis(ms: number): CloudTime {
    const seconds = Math.floor(ms / 1000);
    return new CloudTime(seconds, Math.round(ms - seconds * 1000) * 1_000_000);
  }

  static from(t: TimestampLike): CloudTime {
    return t instanceof CloudTime ? t : new CloudTime(t.seconds, t.nanoseconds);
  }

  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000);
  }

  /** Moves the time by `ms` (may be negative). No BigInt: seconds and nanos are kept apart. */
  plusMillis(ms: number): CloudTime {
    const whole = Math.trunc(ms);
    let seconds = this.seconds + Math.trunc(whole / 1000);
    let nanos = this.nanoseconds + (whole % 1000) * 1_000_000;
    if (nanos < 0) {
      nanos += 1_000_000_000;
      seconds -= 1;
    } else if (nanos > 999_999_999) {
      nanos -= 1_000_000_000;
      seconds += 1;
    }
    return new CloudTime(seconds, nanos);
  }
}

/** True when v looks like a Firestore Timestamp (SDK class, admin class or CloudTime). */
export function isTimestampLike(v: unknown): v is TimestampLike {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isInteger((v as TimestampLike).seconds) &&
    Number.isInteger((v as TimestampLike).nanoseconds) &&
    typeof (v as TimestampLike).toMillis === 'function'
  );
}

/** -1, 0 or 1, exact to the nanosecond. */
export function compareTime(a: TimestampLike, b: TimestampLike): number {
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
  if (a.nanoseconds !== b.nanoseconds) return a.nanoseconds < b.nanoseconds ? -1 : 1;
  return 0;
}

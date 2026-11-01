/**
 * The 18+ age rule (ALGORITHMS §1). Pure functions, no storage, no logging.
 *
 * Rey's decision (Nov 1, 3:00 AM): ask for the BIRTH YEAR with no default
 * (a neutral prompt) and keep only "18 or older: yes/no" plus the date it was
 * checked. The Lead approved Q2 = A (year first, cut-off not shown before the
 * answer) and Q3 = A (birth month only in the boundary year, never stored).
 *
 * Callers must not keep the year, month or day after calling these
 * functions: the screen clears its own state once a result comes back.
 */

/** The legal age for AI features in this app (every provider's terms say 18). */
export const ADULT_AGE = 18;
/** Oldest birth year accepted as real (§1.2). */
export const MIN_BIRTH_YEAR = 1900;

/** Outcome of one step of the age check. */
export type AgeStep =
  | { kind: 'adult' }
  | { kind: 'minor' }
  | { kind: 'need_month' } // boundary year: ask the birth month (§1.3)
  | { kind: 'need_day' } // boundary year AND birth month = this month (§1.3)
  | { kind: 'invalid'; field: 'year' | 'month' | 'day' };

/** Today's date as the three local calendar numbers the rule needs. */
export interface LocalDate {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

/** Local calendar date for a timestamp (the student's own day, like the usage meter). */
export function localDate(ms: number): LocalDate {
  const d = new Date(ms);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** Days in a month of a given year; Feb 29 only in leap years (§1.3). */
export function daysIn(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate();
}

/**
 * Parses what the student typed into a whole number, or null.
 * Accepts digits only (an on-screen number pad can still paste text).
 */
export function parseWhole(raw: string, maxDigits: number): number | null {
  const s = raw.trim();
  if (!new RegExp(`^\\d{1,${maxDigits}}$`).test(s)) return null;
  return Number(s);
}

/** §1.2: decide from the birth year alone, if possible. */
export function checkYear(year: number | null, today: LocalDate): AgeStep {
  // Reject non-numbers, implausible years and future years (§1.2 table, row 1).
  if (year === null || !Number.isInteger(year) || year < MIN_BIRTH_YEAR || year > today.year) {
    return { kind: 'invalid', field: 'year' };
  }
  const d = today.year - year; // whole years between the birth year and this year
  if (d >= ADULT_AGE + 1) return { kind: 'adult' }; // age >= d - 1 >= 18
  if (d <= ADULT_AGE - 1) return { kind: 'minor' }; // age <= d <= 17
  return { kind: 'need_month' }; // d = 18: depends on whether the birthday has passed
}

/** §1.3: boundary year, decide from the birth month (or ask for the day). */
export function checkMonth(year: number, month: number | null, today: LocalDate): AgeStep {
  if (month === null || !Number.isInteger(month) || month < 1 || month > 12) return { kind: 'invalid', field: 'month' };
  // Guard: only meaningful in the boundary year; anything else re-runs the year rule.
  if (today.year - year !== ADULT_AGE) return checkYear(year, today);
  if (month < today.month) return { kind: 'adult' };
  if (month > today.month) return { kind: 'minor' };
  return { kind: 'need_day' };
}

/** §1.3: boundary year and birth month = this month, decide from the day. */
export function checkDay(year: number, month: number, day: number | null, today: LocalDate): AgeStep {
  // Valid days use the BIRTH year, so Feb 29 is accepted only for leap birth years.
  if (day === null || !Number.isInteger(day) || day < 1 || day > daysIn(year, month)) return { kind: 'invalid', field: 'day' };
  // Guard: only meaningful when the month rule asked for the day.
  const viaMonth = checkMonth(year, month, today);
  if (viaMonth.kind !== 'need_day') return viaMonth;
  // Feb 29 in a non-leap current year: 29 > 28 until March, when the month rule says adult (§1.3).
  return day <= today.day ? { kind: 'adult' } : { kind: 'minor' };
}

/**
 * §1.4 The date a "minor" answer may be re-checked: one calendar year after
 * it was recorded (Feb 29 rolls over to Mar 1, the stricter reading).
 */
export function recheckDueAt(checkedAt: number): number {
  const d = new Date(checkedAt);
  const next = new Date(d.getTime());
  next.setFullYear(d.getFullYear() + 1); // Feb 29 + 1 year -> Mar 1 (JS rolls over)
  return next.getTime();
}

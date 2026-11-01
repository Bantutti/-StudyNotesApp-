/**
 * §1 age rule: boundary years, the month and day steps, Feb 29, invalid input
 * and the one-year re-check date.
 */
import { checkDay, checkMonth, checkYear, daysIn, localDate, parseWhole, recheckDueAt, type LocalDate } from '../gate/ageRule';

const today: LocalDate = { year: 2026, month: 11, day: 1 }; // the build date: Nov 1, 2026

describe('§1.2 year rule', () => {
  it.each([
    [2007, 'adult'], // d = 19: at least 18 even before the birthday
    [1950, 'adult'],
    [1900, 'adult'],
    [2008, 'need_month'], // d = 18: 17 or 18 depending on the birthday
    [2009, 'minor'], // d = 17: at most 17
    [2026, 'minor'],
  ])('born %i -> %s', (year, kind) => {
    expect(checkYear(year, today).kind).toBe(kind);
  });

  it.each([[2027], [1899], [null], [2008.5], [Number.NaN]])('rejects %p as a birth year', (year) => {
    expect(checkYear(year as number | null, today)).toEqual({ kind: 'invalid', field: 'year' });
  });
});

describe('§1.3 boundary year (born 2008, today Nov 1, 2026)', () => {
  it('a birthday in an earlier month means 18 (adult)', () => {
    expect(checkMonth(2008, 1, today).kind).toBe('adult');
    expect(checkMonth(2008, 10, today).kind).toBe('adult');
  });
  it('a birthday in a later month means 17 (minor)', () => {
    expect(checkMonth(2008, 12, today).kind).toBe('minor');
  });
  it('a birthday this month asks for the day', () => {
    expect(checkMonth(2008, 11, today).kind).toBe('need_day');
  });
  it('day: on or before today is adult, after today is minor', () => {
    expect(checkDay(2008, 11, 1, today).kind).toBe('adult'); // the 18th birthday is today
    expect(checkDay(2008, 11, 2, today).kind).toBe('minor');
    expect(checkDay(2008, 11, 30, { year: 2026, month: 11, day: 30 }).kind).toBe('adult');
  });
  it.each([[0], [13], [null]])('rejects month %p', (m) => {
    expect(checkMonth(2008, m as number | null, today)).toEqual({ kind: 'invalid', field: 'month' });
  });
  it('rejects a day that does not exist in that month', () => {
    expect(checkDay(2008, 11, 31, today)).toEqual({ kind: 'invalid', field: 'day' });
    expect(checkDay(2008, 11, 0, today)).toEqual({ kind: 'invalid', field: 'day' });
  });
  it('month and day steps re-run the year rule outside the boundary year', () => {
    expect(checkMonth(2000, 12, today).kind).toBe('adult');
    expect(checkMonth(2010, 1, today).kind).toBe('minor');
    expect(checkDay(2008, 3, 5, today).kind).toBe('adult'); // month rule decides, no day needed
  });
});

describe('§1.3 Feb 29 births count as Mar 1 in non-leap years', () => {
  // Born Feb 29, 2008 (a leap year); 2026 is not a leap year.
  it('is still 17 on Feb 28, 2026', () => {
    expect(checkDay(2008, 2, 29, { year: 2026, month: 2, day: 28 }).kind).toBe('minor');
  });
  it('is 18 on Mar 1, 2026', () => {
    expect(checkMonth(2008, 2, { year: 2026, month: 3, day: 1 }).kind).toBe('adult');
  });
  it('Feb 29 is only a valid day in leap birth years', () => {
    expect(daysIn(2008, 2)).toBe(29);
    expect(daysIn(2009, 2)).toBe(28);
    expect(checkDay(2009, 2, 29, { year: 2027, month: 2, day: 28 })).toEqual({ kind: 'invalid', field: 'day' });
  });
});

describe('helpers', () => {
  it('parseWhole accepts digits only, with a length cap', () => {
    expect(parseWhole(' 2008 ', 4)).toBe(2008);
    expect(parseWhole('20a8', 4)).toBeNull();
    expect(parseWhole('-2008', 4)).toBeNull();
    expect(parseWhole('20080', 4)).toBeNull();
    expect(parseWhole('', 4)).toBeNull();
    expect(parseWhole('1e3', 4)).toBeNull();
  });
  it('localDate uses the local calendar', () => {
    const ms = new Date(2026, 10, 1, 23, 59).getTime();
    expect(localDate(ms)).toEqual({ year: 2026, month: 11, day: 1 });
  });
  it('§1.4 re-check is one calendar year later; Feb 29 rolls to Mar 1', () => {
    const t = new Date(2026, 10, 1, 9, 0).getTime();
    expect(new Date(recheckDueAt(t)).getFullYear()).toBe(2027);
    expect(new Date(recheckDueAt(t)).getMonth()).toBe(10);
    const leap = new Date(2028, 1, 29, 9, 0).getTime();
    const due = new Date(recheckDueAt(leap));
    expect([due.getFullYear(), due.getMonth() + 1, due.getDate()]).toEqual([2029, 3, 1]);
  });
});

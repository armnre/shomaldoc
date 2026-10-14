/**
 * Jalali (Persian solar) calendar helpers.
 *
 * Conversion relies on the ICU Persian calendar exposed by Intl (available in
 * Node.js and all modern browsers), so no hand-maintained leap-year tables are
 * needed. Jalali→Gregorian is resolved by walking day-by-day from an anchor and
 * is monotone, so invalid dates (e.g. Mehr 31) are rejected explicitly.
 */

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

export interface GregorianDate {
  gy: number;
  gm: number;
  gd: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const persianParts = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
  timeZone: "UTC",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

function partNumber(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const found = parts.find((p) => p.type === type);
  if (!found) throw new Error(`Missing ${type} in Persian calendar output`);
  return Number(found.value);
}

function assertGregorian(gy: number, gm: number, gd: number): Date {
  const date = new Date(Date.UTC(gy, gm - 1, gd));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== gy ||
    date.getUTCMonth() !== gm - 1 ||
    date.getUTCDate() !== gd
  ) {
    throw new RangeError(`Invalid Gregorian date ${gy}-${gm}-${gd}`);
  }
  return date;
}

export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  const date = assertGregorian(gy, gm, gd);
  const parts = persianParts.formatToParts(date);
  return {
    jy: partNumber(parts, "year"),
    jm: partNumber(parts, "month"),
    jd: partNumber(parts, "day"),
  };
}

export function isValidJalaliShape(jy: number, jm: number, jd: number): boolean {
  return (
    Number.isInteger(jy) &&
    Number.isInteger(jm) &&
    Number.isInteger(jd) &&
    jy >= 1 &&
    jm >= 1 &&
    jm <= 12 &&
    jd >= 1 &&
    jd <= 31
  );
}

/** Days from Farvardin 1 to the first day of month `jm`. */
function monthOffset(jm: number): number {
  return jm <= 7 ? (jm - 1) * 31 : 186 + (jm - 7) * 30;
}

function compareJalali(a: JalaliDate, b: JalaliDate): number {
  return a.jy - b.jy || a.jm - b.jm || a.jd - b.jd;
}

function utcToGregorian(time: number): GregorianDate {
  const d = new Date(time);
  return { gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() };
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): GregorianDate {
  if (!isValidJalaliShape(jy, jm, jd)) {
    throw new RangeError(`Invalid Jalali date shape ${jy}/${jm}/${jd}`);
  }
  const target: JalaliDate = { jy, jm, jd };
  // Nowruz (Farvardin 1) is on or about March 21 of the matching Gregorian year.
  let cursor = Date.UTC(jy + 621, 2, 21) + (monthOffset(jm) + jd - 1) * DAY_MS;
  let lastDirection = 0;

  for (let step = 0; step < 1000; step++) {
    const current = gregorianToJalali(...toTuple(utcToGregorian(cursor)));
    const cmp = compareJalali(current, target);
    if (cmp === 0) return utcToGregorian(cursor);
    const direction = cmp < 0 ? 1 : -1;
    // Because the mapping is monotone, a direction flip means the target day was skipped.
    if (lastDirection !== 0 && direction !== lastDirection) break;
    lastDirection = direction;
    cursor += direction * DAY_MS;
  }
  throw new RangeError(`Jalali date ${jy}/${jm}/${jd} does not exist`);
}

function toTuple(g: GregorianDate): [number, number, number] {
  return [g.gy, g.gm, g.gd];
}

export function isValidJalaliDate(jy: number, jm: number, jd: number): boolean {
  try {
    jalaliToGregorian(jy, jm, jd);
    return true;
  } catch {
    return false;
  }
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm < 1 || jm > 12) throw new RangeError(`Invalid Jalali month ${jm}`);
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isValidJalaliDate(jy, 12, 30) ? 30 : 29;
}

export function formatJalaliISO(date: JalaliDate): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.jy}/${pad(date.jm)}/${pad(date.jd)}`;
}

export const JALALI_MONTH_NAMES = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;

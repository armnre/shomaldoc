import { describe, expect, it } from "vitest";
import {
  formatJalaliISO,
  gregorianToJalali,
  isValidJalaliDate,
  jalaliMonthLength,
  jalaliToGregorian,
} from "@/lib/jalali";

describe("jalali conversion", () => {
  it("matches known Nowruz anchors", () => {
    expect(gregorianToJalali(2024, 3, 20)).toEqual({ jy: 1403, jm: 1, jd: 1 });
    expect(gregorianToJalali(2025, 3, 21)).toEqual({ jy: 1404, jm: 1, jd: 1 });
    expect(jalaliToGregorian(1403, 1, 1)).toEqual({ gy: 2024, gm: 3, gd: 20 });
    expect(jalaliToGregorian(1404, 1, 1)).toEqual({ gy: 2025, gm: 3, gd: 21 });
  });

  it("round-trips every 13th day across a decade", () => {
    const start = Date.UTC(2018, 0, 1);
    for (let i = 0; i < 365 * 8; i += 13) {
      const d = new Date(start + i * 86400000);
      const gy = d.getUTCFullYear();
      const gm = d.getUTCMonth() + 1;
      const gd = d.getUTCDate();
      const j = gregorianToJalali(gy, gm, gd);
      expect(jalaliToGregorian(j.jy, j.jm, j.jd)).toEqual({ gy, gm, gd });
    }
  });

  it("rejects days that do not exist", () => {
    expect(isValidJalaliDate(1403, 7, 31)).toBe(false);
    expect(() => jalaliToGregorian(1403, 7, 31)).toThrow();
    expect(() => gregorianToJalali(2025, 2, 30)).toThrow();
  });

  it("month length agrees with the calendar boundary", () => {
    for (const jy of [1398, 1399, 1403, 1404]) {
      for (let jm = 1; jm <= 12; jm++) {
        const len = jalaliMonthLength(jy, jm);
        expect(isValidJalaliDate(jy, jm, len)).toBe(true);
        expect(isValidJalaliDate(jy, jm, len + 1)).toBe(false);
      }
    }
  });

  it("formats as yyyy/mm/dd with padding", () => {
    expect(formatJalaliISO({ jy: 1405, jm: 1, jd: 5 })).toBe("1405/01/05");
  });
});

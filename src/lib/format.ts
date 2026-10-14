import type { Locale } from "@/i18n/config";

const DISPLAY_TZ = "Asia/Tehran";

/** Persian UI uses Persian digits and the Jalali calendar; English uses Latin digits and Gregorian dates. */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(value);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: Date | string | null | undefined, locale: Locale): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-US", {
    timeZone: DISPLAY_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined, locale: Locale): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-US", {
    timeZone: DISPLAY_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatRelativeCount(value: number, locale: Locale): string {
  return formatNumber(value, locale);
}

/** Display helpers keep string signatures; invalid input/options render a dash. */
export const formatDate = (
  value: string,
  locale: "vi" | "en",
  timezone: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string => {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    !timezone
  )
    return "—";
  try {
    return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
      ...options,
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return "—";
  }
};
export const formatNumber = (
  value: number,
  locale: "vi" | "en",
  options?: Intl.NumberFormatOptions,
): string => {
  if (!Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(
      locale === "vi" ? "vi-VN" : "en-US",
      options,
    ).format(value);
  } catch {
    return "—";
  }
};
/** Gregorian YYYY-MM-DD in the selected zone; invalid input yields no day key. */
export const dayKey = (value: string, timezone: string): string => {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    !timezone
  )
    return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return "";
  }
};

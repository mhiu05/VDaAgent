import { describe, expect, it } from "vitest";
import { dayKey, formatDate, formatNumber } from "../../../src/shared/lib/format";

describe("shared locale formatting", () => {
  const instant = "2026-10-16T23:30:00Z";
  it.each(["vi", "en"] as const)(
    "formats dates and numbers in %s",
    (locale) => {
      const language = locale === "vi" ? "vi-VN" : "en-US";
      const options: Intl.DateTimeFormatOptions = {
        dateStyle: "full",
        timeStyle: "short",
      };
      expect(formatDate(instant, locale, "Asia/Bangkok", options)).toBe(
        new Intl.DateTimeFormat(language, {
          ...options,
          timeZone: "Asia/Bangkok",
        }).format(new Date(instant)),
      );
      expect(formatNumber(1234.56, locale, { minimumFractionDigits: 2 })).toBe(
        new Intl.NumberFormat(language, { minimumFractionDigits: 2 }).format(
          1234.56,
        ),
      );
      expect(formatNumber(0, locale)).toBe("0");
      expect(formatNumber(-42, locale)).toBe("-42");
    },
  );
  it("uses the requested timezone for stable calendar keys, including DST", () => {
    expect(dayKey(instant, "UTC")).toBe("2026-10-16");
    expect(dayKey(instant, "Asia/Bangkok")).toBe("2026-10-17");
    expect(dayKey("2026-01-01T00:30:00Z", "America/Los_Angeles")).toBe(
      "2025-12-31",
    );
    expect(dayKey("2026-03-08T06:59:00Z", "America/New_York")).toBe(
      "2026-03-08",
    );
    expect(dayKey("2026-03-08T07:01:00Z", "America/New_York")).toBe(
      "2026-03-08",
    );
  });
  it.each(["", "not-a-date", "2026-13-01T00:00:00Z"])(
    "keeps invalid dates out of UI and calendar groups: %s",
    (value) => {
      expect(formatDate(value, "vi", "UTC")).toBe("—");
      expect(dayKey(value, "UTC")).toBe("");
    },
  );
  it("does not substitute the host timezone for an invalid display zone", () => {
    expect(formatDate(instant, "en", "invalid/zone")).toBe("—");
    expect(dayKey(instant, "invalid/zone")).toBe("");
  });
  it.each([NaN, Infinity, -Infinity])(
    "does not present non-finite values as data: %s",
    (value) => {
      expect(formatNumber(value, "vi")).toBe("—");
    },
  );
  it("handles invalid formatter options without crashing a feature", () => {
    expect(formatNumber(1, "en", { style: "currency" })).toBe("—");
    expect(
      formatDate(instant, "en", "UTC", { dateStyle: "short", year: "numeric" }),
    ).toBe("—");
  });
});

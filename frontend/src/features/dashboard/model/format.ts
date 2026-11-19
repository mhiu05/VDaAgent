import type { Metric } from "./types";
import { formatNumber } from "../../../shared/lib/format";

export function formatMetric(metric: Metric, locale: "vi-VN" | "en-US") {
  const language = locale === "vi-VN" ? "vi" : "en";
  return {
    value:
      metric.value === null
        ? locale === "vi-VN"
          ? "Chưa đủ dữ liệu"
          : "Insufficient data"
        : formatNumber(metric.value, language, {
            maximumFractionDigits: metric.unit === "%" ? 1 : 0,
          }),
    delta:
      metric.delta === null
        ? null
        : `${formatNumber(metric.delta, language, { maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: "always" })} ${metric.deltaUnit === "percentagePoints" ? (locale === "vi-VN" ? "đpt" : "pp") : "%"}`,
    // Raw fields remain intact; display rounding never feeds another calculation.
    raw: metric.value,
  };
}

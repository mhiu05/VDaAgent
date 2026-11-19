import { useTranslation } from "react-i18next";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatNumber } from "../../../shared/lib/format";
import { ChartFrame, TableSurface } from "../../../shared/ui/data";
import type { InventorySummary, TrendPoint } from "../model/types";

export function InventoryAgeChart({
  summary,
  scope,
  onInspect,
}: {
  summary: InventorySummary;
  scope: string;
  onInspect(band: string, trigger: HTMLElement): void;
}) {
  const { preferences } = usePreferences();
  const { t } = useTranslation("dashboard");
  const maximum = Math.max(1, ...summary.bins.map((bin) => bin.count));
  return (
    <ChartFrame
      motion="panel"
      title={t("ageTitle")}
      unit={t("units")}
      scope={scope}
      summary={t("ageQuestion")}
    >
      <div
        className="inventory-bars"
        role="group"
        aria-label={`${t("ageAxis")} · ${t("countAxis")}`}
      >
        {summary.bins.map((bin) => (
          <button
            key={bin.id}
            className="inventory-bar-row"
            onClick={(e) => onInspect(bin.id, e.currentTarget)}
            title={`${t(bin.id)}: ${bin.count} ${t("units")}`}
          >
            <span>{t(bin.id)}</span>
            <span
              className={`inventory-bar-track ${bin.id === "unknown" ? "unknown" : ""}`}
            >
              <span style={{ width: `${(bin.count / maximum) * 100}%` }} />
            </span>
            <strong className="number">{bin.count}</strong>
          </button>
        ))}
        <p className="muted dashboard-axis">
          0{" "}
          <span>
            {maximum} {t("units")} →
          </span>
        </p>
      </div>
      <p className="chart-interpretation">
        {t("ageSummary", { slow: summary.slow, unknown: summary.unknown })}
      </p>
      <details>
        <summary>{t("table")}</summary>
        <TableSurface
          caption={t("ageTitle")}
          header={
            <tr>
              <th scope="col">{t("band")}</th>
              <th scope="col">{t("count")}</th>
              <th scope="col">{t("share")}</th>
            </tr>
          }
        >
          {summary.bins.map((bin) => (
            <tr key={bin.id}>
              <th scope="row">{t(bin.id)}</th>
              <td className="number">
                {bin.count} / {summary.total}
              </td>
              <td className="number">
                {summary.total
                  ? formatNumber(
                      (bin.count / summary.total) * 100,
                      preferences.locale,
                      { maximumFractionDigits: 1 },
                    )
                  : "—"}
                %
              </td>
            </tr>
          ))}
        </TableSurface>
      </details>
    </ChartFrame>
  );
}

export function TransactionTrendChart({
  points,
  scope,
  current,
  previous,
}: {
  points: readonly TrendPoint[];
  scope: string;
  current: number | null;
  previous: number | null;
}) {
  const { preferences } = usePreferences();
  const { t } = useTranslation("dashboard");
  const maximum = Math.max(
    1,
    ...points.flatMap((p) => [p.current ?? 0, p.previous ?? 0]),
  );
  const x = (i: number) => 52 + (i / Math.max(1, points.length - 1)) * 540;
  const y = (value: number) => 170 - (value / maximum) * 144;
  const path = (key: "current" | "previous") => {
    let gap = true;
    return points
      .map((point, i) => {
        if (point[key] === null) {
          gap = true;
          return "";
        }
        const command = `${gap ? "M" : "L"} ${x(i).toFixed(1)} ${y(point[key]!).toFixed(1)}`;
        gap = false;
        return command;
      })
      .join(" ");
  };
  return (
    <ChartFrame
      motion="panel"
      title={t("trendTitle")}
      unit={t("transactionAxis")}
      scope={scope}
      summary={t("trendQuestion")}
    >
      <div className="trend-legend">
        <span>
          <i />
          {t("current")} ({points[0]?.currentDate} →{" "}
          {points.at(-1)?.currentDate})
        </span>
        <span>
          <i className="previous" />
          {t("previous")} ({points[0]?.previousDate} →{" "}
          {points.at(-1)?.previousDate})
        </span>
      </div>
      <svg
        className="transaction-plot"
        viewBox="0 0 640 220"
        role="img"
        aria-label={`${t("trendTitle")} · ${t("transactionAxis")}`}
      >
        {[0, 1, 2, 3].map((step) => {
          const value = (maximum * step) / 3;
          return (
            <g key={step}>
              <line
                x1="52"
                x2="592"
                y1={y(value)}
                y2={y(value)}
                className="plot-grid"
              />
              <text x="42" y={y(value) + 4} textAnchor="end">
                {formatNumber(value, preferences.locale, {
                  maximumFractionDigits: value % 1 ? 1 : 0,
                })}
              </text>
            </g>
          );
        })}
        <path d={path("previous")} className="plot-line previous" />
        <path d={path("current")} className="plot-line" />
        {points.map((point, i) =>
          point.current !== null ? (
            <circle
              key={point.day}
              cx={x(i)}
              cy={y(point.current)}
              r="3"
              className="plot-point"
            >
              <title>
                {point.currentDate}: {point.current} · {point.previousDate}:{" "}
                {point.previous ?? t("missing")} {t("transactionsUnit")}
              </title>
            </circle>
          ) : null,
        )}
        {[0, Math.floor((points.length - 1) / 2), points.length - 1].map(
          (index, key) => (
            <text key={key} x={x(index)} y="191" textAnchor="middle">
              {index + 1}
            </text>
          ),
        )}
        <text x="322" y="215" textAnchor="middle">
          {t("day")}
        </text>
      </svg>
      <p className="chart-interpretation">
        {current !== null && previous !== null
          ? t("trendSummary", { current, previous, days: points.length })
          : t("gapNote")}
      </p>
      <details>
        <summary>{t("table")}</summary>
        <TableSurface
          caption={t("trendTitle")}
          header={
            <tr>
              <th scope="col">{t("current")}</th>
              <th scope="col">{t("count")}</th>
              <th scope="col">{t("previous")}</th>
              <th scope="col">{t("count")}</th>
            </tr>
          }
        >
          {points.map((point) => (
            <tr key={point.day}>
              <th scope="row">{point.currentDate}</th>
              <td className="number">{point.current ?? t("missing")}</td>
              <td>{point.previousDate}</td>
              <td className="number">{point.previous ?? t("missing")}</td>
            </tr>
          ))}
        </TableSurface>
      </details>
    </ChartFrame>
  );
}

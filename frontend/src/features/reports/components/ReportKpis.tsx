import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { useAnalyticalMotion } from "../../../shared/motion/useAnalyticalMotion";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatNumber } from "../../../shared/lib/format";

export interface ReportKpiValue {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  definition?: string;
  comparison?: string;
}

export function ReportKpis({
  metrics,
  precision = 2,
}: {
  metrics: readonly ReportKpiValue[];
  precision?: number;
}) {
  const { preferences } = usePreferences();
  const { t } = useTranslation("reports");
  const root = useRef<HTMLDListElement>(null);
  useAnalyticalMotion(
    root,
    metrics.map((m) => `${m.id}:${m.value}`).join("|"),
    "dashboard",
  );
  return (
    <dl ref={root} className="report-kpis" data-motion-owner>
      {metrics.map((metric) => (
        <div key={metric.id} data-motion="kpi">
          <dt>{metric.label}</dt>
          <dd>
            <strong className="number">
              {metric.value === null
                ? "—"
                : formatNumber(metric.value, preferences.locale, {
                    maximumFractionDigits: precision,
                  })}
            </strong>{" "}
            <span>{metric.unit}</span>
            {metric.comparison ? (
              <p className="report-kpi-comparison">{metric.comparison}</p>
            ) : null}
            {metric.definition ? (
              <details className="report-kpi-definition">
                <summary>{t("definition")}</summary>
                <p>{metric.definition}</p>
              </details>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

import React from "react";
import { AlertTriangle, CheckCircle2, Database, Info, Rows3, ShieldAlert, Table2 } from "lucide-react";
import { formatCompact, formatPercentValue } from "../utils/reportMetrics.js";

export function OverviewMetrics({ overview }) {
  const scoreTone = overview.score === null ? "neutral" : overview.score >= 90 ? "good" : overview.score >= 75 ? "warn" : "bad";
  return (
    <section className="overview-band">
      {overview.score !== null ? (
        <div className={`quality-score-card ${scoreTone}`} title="Calculated from missing ratio and returned finding severities.">
          <span>Quality score</span>
          <strong>{overview.score}</strong>
          <small>/100</small>
        </div>
      ) : null}
      <KpiTile icon={Rows3} label="Rows" value={formatCompact(overview.rows)} />
      <KpiTile icon={Table2} label="Columns" value={formatCompact(overview.columns)} />
      <KpiTile icon={Database} label="Missing" value={formatPercentValue(overview.missingRatio)} tone={Number(overview.missingRatio) >= 0.1 ? "warn" : "good"} />
      <KpiTile icon={CheckCircle2} label="Duplicate" value={formatPercentValue(overview.duplicateRatio)} tooltip="Shown only when duplicate_ratio is returned by the backend." />
      <KpiTile icon={AlertTriangle} label="Warnings" value={overview.warningCount} tone={overview.warningCount ? "warn" : "good"} />
      <KpiTile icon={ShieldAlert} label="Critical" value={overview.criticalCount} tone={overview.criticalCount ? "bad" : "good"} />
      <KpiTile icon={Info} label="Info" value={overview.infoCount} tone="info" />
    </section>
  );
}

function KpiTile({ icon: Icon, label, value, tone = "neutral", tooltip }) {
  return (
    <div className={`kpi-tile ${tone}`} title={tooltip || label}>
      <span><Icon size={15} /> {label}</span>
      <strong>{value ?? "-"}</strong>
    </div>
  );
}

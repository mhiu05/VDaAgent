import React from "react";
import { HelpCircle } from "lucide-react";

export const ISSUE_EXPLANATION = {
  ok: "OK: no finding was generated for the column.",
  info: "Info: observation that may be useful but does not necessarily indicate a quality problem.",
  warning: "Warning: a possible data quality, PII, identifier, missing-data, or outlier issue that should be reviewed.",
  critical: "Critical: a severe validation or declared-schema/key failure requiring action.",
};

export function SeverityLegend() {
  return (
    <div className="issue-legend" aria-label="Issue severity legend">
      {Object.entries(ISSUE_EXPLANATION).map(([tone, tooltip]) => (
        <span className={`issue-legend-item ${tone}`} key={tone}>
          {tone}
          <span className="lookup-tooltip" data-tooltip={tooltip} aria-label={tooltip} tabIndex={0}>
            <HelpCircle size={13} />
          </span>
        </span>
      ))}
    </div>
  );
}

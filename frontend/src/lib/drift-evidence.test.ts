import { describe, expect, it } from "vitest";

import { driftDisplayValue, driftEvidenceLabel, groupDriftFindings } from "./drift-evidence";

describe("shared drift evidence model", () => {
  it("keeps grouping, severity, evidence, and values consistent", () => {
    const reports = [{
      drift_columns: [
        {
          column_name: "revenue",
          drift_type: "numeric_shift",
          severity: "major",
          metric: "mean",
          psi: 0.12345,
          baseline_value: "10.1234",
          current_value: 20.98765,
        },
        {
          column_name: "revenue",
          drift_type: "null_rate_shift",
          severity: "minor",
          metric: "null_pct",
          baseline_value: null,
          current_value: 0.1,
        },
        {
          column_name: "region",
          drift_type: "column_added",
          severity: "minor",
        },
      ],
    }];

    expect(groupDriftFindings(reports).map((column) => ({
      name: column.name,
      severity: column.severity,
      signalCount: column.findings.length,
    }))).toEqual([
      { name: "revenue", severity: "major", signalCount: 2 },
      { name: "region", severity: "minor", signalCount: 1 },
    ]);
    expect(driftEvidenceLabel(reports[0].drift_columns[0])).toBe("PSI 0,123");
    expect(driftEvidenceLabel(reports[0].drift_columns[1])).toBe("Tỷ lệ thiếu");
    expect(driftDisplayValue("10.1234")).toBe("10.1234");
    expect(driftDisplayValue(20.98765)).toBe("20,988");
    expect(driftDisplayValue(null)).toBe("—");
  });
});

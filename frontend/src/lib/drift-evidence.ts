export type DriftRecord = Record<string, unknown>;
export type DriftSeverity = "major" | "minor";
export type DriftColumn = { name: string; findings: DriftRecord[]; severity: DriftSeverity };

export const DRIFT_PART_TITLE = "PHẦN 3: SO SÁNH DỮ LIỆU";
export const driftTypeLabels: Record<string, string> = {
  column_added: "Cột mới",
  column_removed: "Cột bị thiếu",
  dtype_changed: "Thay đổi kiểu dữ liệu",
  null_rate_shift: "Thay đổi tỷ lệ thiếu",
  numeric_shift: "Thay đổi chỉ số số",
  distribution_shift: "Thay đổi phân phối",
};
export const driftSeverityLabels: Record<DriftSeverity, string> = { major: "Nghiêm trọng", minor: "Cần theo dõi" };

function isRecord(value: unknown): value is DriftRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function flattenDriftFindings(reports: unknown[]): DriftRecord[] {
  return reports.flatMap((report) => {
    if (!isRecord(report) || !Array.isArray(report.drift_columns)) return [];
    return report.drift_columns.filter(isRecord);
  });
}

export function groupDriftFindings(reports: unknown[]): DriftColumn[] {
  const groups = new Map<string, DriftRecord[]>();
  flattenDriftFindings(reports).forEach((finding) => {
    const name = typeof finding.column_name === "string" && finding.column_name.trim() ? finding.column_name : "Dataset";
    groups.set(name, [...(groups.get(name) || []), finding]);
  });
  return [...groups.entries()].map(([name, findings]) => ({
    name,
    findings,
    severity: findings.some((finding) => finding.severity === "major") ? "major" : "minor",
  }));
}

export function driftDisplayValue(value: unknown): string {
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(value);
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function driftDetailText(value: unknown): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function driftEvidenceLabel(value: unknown): string {
  const finding = isRecord(value) ? value : undefined;
  if (typeof finding?.psi === "number") return `PSI ${driftDisplayValue(finding.psi)}`;
  if (finding?.metric === "null_pct") return "Tỷ lệ thiếu";
  if (finding?.metric) return String(finding.metric);
  if (finding?.drift_type && driftTypeLabels[String(finding.drift_type)]) return driftTypeLabels[String(finding.drift_type)];
  return finding?.drift_type ? String(finding.drift_type) : "—";
}

export function driftTypeLabel(value: unknown): string {
  const key = typeof value === "string" ? value : "";
  return driftTypeLabels[key] || key || "Drift";
}

export function driftSeverityLabel(value: unknown): string {
  if (value === "major" || value === "minor") return driftSeverityLabels[value];
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function driftSignalLabel(count: number): string {
  return `${count} signal`;
}

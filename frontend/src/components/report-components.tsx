import { formatNumber, formatPercent } from "@/lib/format";
import type { ColumnStat } from "@/lib/types";

type TopValueRow = { value: string; count: number | null; note: string | null };

export function displayTopValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(trống)";
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${displayTopValue(item)}`)
      .join(" · ");
  }
  return String(value);
}

export function topValueRows(raw: unknown): TopValueRow[] {
  if (Array.isArray(raw)) {
    return raw.slice(0, 5).map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return { value: displayTopValue(item), count: null, note: null };
      }
      const record = item as Record<string, unknown>;
      const value = Object.prototype.hasOwnProperty.call(record, "value")
        ? record.value
        : Object.prototype.hasOwnProperty.call(record, "label") ? record.label : record;
      const parsedCount = Number(record.count);
      return {
        value: displayTopValue(value),
        count: Number.isFinite(parsedCount) ? parsedCount : null,
        note: typeof record.label === "string" && !Number.isFinite(parsedCount) ? record.label : null,
      };
    });
  }
  if (typeof raw === "object" && raw !== null) {
    return Object.entries(raw as Record<string, unknown>).slice(0, 5).map(([value, count]) => {
      const parsedCount = Number(count);
      return { value: displayTopValue(value), count: Number.isFinite(parsedCount) ? parsedCount : null, note: null };
    });
  }
  return [{ value: displayTopValue(raw), count: null, note: null }];
}

export function TopValues({ stat }: { stat: ColumnStat }) {
  if (stat.pii_masked) return <span className="chip pii">Đã ẩn PII</span>;
  if (!stat.top_k_values) return <span className="muted">—</span>;
  const rows = topValueRows(stat.top_k_values);
  if (!rows.length) return <span className="muted">—</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {rows.map((row, index) => (
        <span 
          key={`${row.value}-${index}`} 
          style={{ 
            background: "#f8fafc", 
            border: "1px solid #e2e8f0", 
            borderRadius: "4px", 
            padding: "2px 6px", 
            fontSize: "0.85em",
            display: "inline-block",
            whiteSpace: "nowrap"
          }}
          title={row.note ? String(row.note) : undefined}
        >
          <strong style={{ color: "#334155" }}>{String(row.value)}</strong>
          {row.count !== null && (
            <span style={{ color: "#64748b", marginLeft: "4px" }}>({formatNumber(row.count)})</span>
          )}
        </span>
      ))}
    </div>
  );
}

export function Distribution({ stat, totalRows }: { stat: ColumnStat; totalRows?: number | null }) {
  if (stat.pii_masked || !stat.top_k_values || typeof stat.top_k_values !== "object") return <span className="muted">Không có phân phối an toàn để hiển thị.</span>;
  const entries = (Array.isArray(stat.top_k_values)
    ? stat.top_k_values
      .filter((item): item is { value?: unknown; count?: unknown } => typeof item === "object" && item !== null)
      .map((item) => ({ label: String(item.value ?? "—"), count: Number(item.count) }))
    : Object.entries(stat.top_k_values as Record<string, unknown>)
      .map(([label, count]) => ({ label, count: Number(count) })))
    .filter((entry) => Number.isFinite(entry.count))
    .slice(0, 5);
  if (!entries.length) return <span className="muted">Chưa có phân phối danh mục (category) an toàn để hiển thị.</span>;
  const max = Math.max(...entries.map((entry) => entry.count), 1);
  const total = Number(totalRows) || Number(stat.row_count) || null;
  return <div className="chart-bars">{entries.map((entry) => <div className="bar-row" key={entry.label}><span className="truncate" title={entry.label}>{entry.label}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${(entry.count / max) * 100}%` }} /></span><b>{formatNumber(entry.count)} {total ? <small>({formatPercent(entry.count / total, 2)})</small> : null}</b></div>)}</div>;
}

export function metricPercent(value: number | null | undefined, ratio: boolean): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const percent = ratio && Math.abs(value) <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, percent));
}

export function MetricChart({ title, columns, metric, ratio = false, warning = false }: {
  title: string;
  columns: ColumnStat[];
  metric: "null_pct" | "uniqueness_ratio";
  ratio?: boolean;
  warning?: boolean;
}) {
  const rows = columns
    .map((stat) => ({ name: stat.column_name, value: metricPercent(stat[metric] as number | null | undefined, ratio) }))
    .filter((item): item is { name: string; value: number } => item.value !== null)
    .sort((left, right) => right.value - left.value)
    .slice(0, 10);
  if (!rows.length) return null;
  return <section className="panel metric-chart"><div className="panel-title"><div><h2>{title}</h2><small>Top {rows.length} cột · thang đo 0–100%</small></div><span className="chip">Biểu đồ</span></div><div className="chart-bars">{rows.map((row) => <div className="bar-row" key={row.name}><span className="truncate" title={row.name}>{row.name}</span><span className="bar-track"><span className={`bar-fill ${warning ? "warning" : ""}`} style={{ width: `${row.value}%` }} /></span><b>{formatNumber(row.value, 1)}%</b></div>)}</div><div className="metric-chart-scale"><span>0%</span><span>100%</span></div></section>;
}

export function correlationStrength(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 0.8) return "Rất mạnh";
  if (absolute >= 0.6) return "Mạnh";
  if (absolute >= 0.4) return "Vừa";
  if (absolute >= 0.2) return "Yếu";
  return "Rất yếu";
}

export function CorrelationPanel({ matrix }: { matrix: Record<string, Record<string, number>> }) {
  const pairs = Object.entries(matrix)
    .flatMap(([left, values]) => Object.entries(values).filter(([right]) => left < right).map(([right, value]) => ({ left, right, value: Number(value) })))
    .filter((pair) => Number.isFinite(pair.value))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value));

  if (!pairs.length) return <p className="muted">Không đủ cột dữ liệu số (numeric) để tính độ tương quan (correlation).</p>;

  return <>
    <div className="correlation-legend"><span><i className="correlation-swatch positive" /> Dương</span><span><i className="correlation-swatch negative" /> Âm</span><span>Gần 0 = ít liên hệ tuyến tính</span></div>
    <div className="correlation">{pairs.map((pair) => <div className={`correlation-cell ${pair.value >= 0 ? "positive" : "negative"}`} key={`${pair.left}-${pair.right}`}><div className="correlation-pair" title={`${pair.left} × ${pair.right}`}>{pair.left} <span>×</span> {pair.right}</div><div className="correlation-score"><b>r = {formatNumber(pair.value, 3)}</b><small>{pair.value >= 0 ? "Dương" : "Âm"} · {correlationStrength(pair.value)}</small></div></div>)}</div>
    <p className="muted correlation-note">Pearson r chỉ phản ánh tương quan tuyến tính; không chứng minh quan hệ nhân quả.</p>
  </>;
}

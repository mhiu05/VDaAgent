import React from "react";
import type { AnalysisExecution, ChartSpec, QuerySpec } from "@/lib/analysis-types";
import { formatNumber } from "@/lib/format";
import type { CSSProperties } from "react";

type Props = {
  chartSpec: ChartSpec;
  result: AnalysisExecution["result"];
  querySpec: QuerySpec;
  title?: string;
};

function rowLabel(row: Record<string, unknown>, querySpec: QuerySpec): string {
  if (row.column !== undefined) return String(row.column);
  const dimension = querySpec.dimensions[0];
  return dimension ? String(row[dimension] ?? "-") : "Kết quả";
}

function divergingBarStyle(value: number, maxAbsolute: number): CSSProperties {
  const width = `${Number.isFinite(value) ? Math.abs(value) / maxAbsolute * 50 : 0}%`;
  return value < 0 ? { width, right: "50%" } : { width, left: "50%" };
}

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ChartEvidenceView({ chartSpec, result, querySpec, title }: Props) {
  const forecastMode = querySpec.analysis_kind === "forecast";
  const matrixMode = ["missing_heatmap", "correlation_heatmap"].includes(chartSpec.chart_type);
  const limit = chartSpec.chart_type === "table" ? 50 : forecastMode ? 72 : chartSpec.chart_type === "violin" ? 160 : matrixMode ? 144 : 12;
  const rows = forecastMode ? result.data.slice(-limit) : result.data.slice(0, limit);
  const values = rows.map((row) => Number(row.value));
  const finiteValues = values.filter(Number.isFinite);
  if (!rows.length || !finiteValues.length) {
    return <div className="chart-empty-canvas" role="status"><span>Không có dữ liệu để vẽ</span><small>Hãy kiểm tra bộ lọc, cột measure và khoảng thời gian.</small></div>;
  }
  const max = Math.max(...finiteValues, 1);
  const min = Math.min(...finiteValues, 0);

  if (chartSpec.chart_type === "histogram") {
    return <div className="chart-histogram" role="img" aria-label={title || "Histogram"}>{rows.map((row, index) => { const value = numeric(row.value) ?? 0; const start = numeric(row.bin_start); const end = numeric(row.bin_end); const label = start === null || end === null ? `Khoảng ${index + 1}` : `${formatNumber(start)}–${formatNumber(end)}`; return <div className="histogram-column" key={index}><span className="histogram-value">{formatNumber(value)}</span><span className="histogram-bar" style={{ height: `${Math.max(value / max * 100, 2)}%` }}><span className="sr-only">{label}: {formatNumber(value)}</span></span><span className="histogram-label" title={label}>{label}</span></div>; })}</div>;
  }

  if (chartSpec.chart_type === "scatter") {
    const points = rows.map((row) => ({ x: numeric(row.x), y: numeric(row.y), count: numeric(row.value) ?? 1 })).filter((point): point is { x: number; y: number; count: number } => point.x !== null && point.y !== null);
    if (!points.length) return <div className="chart-empty-canvas" role="status">Không có ô mật độ hợp lệ.</div>;
    const width = 720; const height = 260; const padding = 24;
    const xs = points.map((point) => point.x); const ys = points.map((point) => point.y); const counts = points.map((point) => point.count);
    const xMin = Math.min(...xs); const xSpread = Math.max(Math.max(...xs) - xMin, 1); const yMin = Math.min(...ys); const ySpread = Math.max(Math.max(...ys) - yMin, 1); const countMax = Math.max(...counts, 1);
    return <div className="chart-scatter-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title || "Biểu đồ scatter mật độ"} className="chart-scatter-svg"><line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} /><line x1={padding} y1={padding} x2={padding} y2={height - padding} />{points.map((point, index) => { const cx = padding + (point.x - xMin) / xSpread * (width - padding * 2); const cy = height - padding - (point.y - yMin) / ySpread * (height - padding * 2); return <circle key={index} cx={cx} cy={cy} r={4 + Math.sqrt(point.count / countMax) * 10}><title>{`${querySpec.x_column}: ${formatNumber(point.x)} · ${querySpec.y_column}: ${formatNumber(point.y)} · ${formatNumber(point.count)} dòng`}</title></circle>; })}</svg><div className="chart-scatter-labels"><span>{querySpec.y_column}</span><span>{querySpec.x_column}</span></div><small className="chart-truncation">Mỗi điểm là một ô mật độ tổng hợp, không phải dòng dữ liệu thô.</small></div>;
  }

  if (chartSpec.chart_type === "box") {
    const summaries = rows.map((row, index) => ({ label: String(row.group_label ?? `Tổng thể ${index + 1}`), min: numeric(row.min), q1: numeric(row.q1), median: numeric(row.median), q3: numeric(row.q3), max: numeric(row.max), count: numeric(row.count) })).filter((row): row is { label: string; min: number; q1: number; median: number; q3: number; max: number; count: number | null } => row.min !== null && row.q1 !== null && row.median !== null && row.q3 !== null && row.max !== null);
    if (!summaries.length) return <div className="chart-empty-canvas" role="status">Không có tóm tắt năm số hợp lệ.</div>;
    const domainMin = Math.min(...summaries.map((row) => row.min)); const spread = Math.max(Math.max(...summaries.map((row) => row.max)) - domainMin, 1);
    return <div className="chart-box-list" role="img" aria-label={title || "Box plot"}>{summaries.map((row) => { const position = (value: number) => `${(value - domainMin) / spread * 100}%`; return <div className="chart-box-row" key={row.label}><span className="truncate" title={row.label}>{row.label}</span><span className="chart-box-track"><i className="chart-box-whisker" style={{ left: position(row.min), width: `${(row.max - row.min) / spread * 100}%` }} /><i className="chart-box-body" style={{ left: position(row.q1), width: `${Math.max((row.q3 - row.q1) / spread * 100, 0.8)}%` }} /><i className="chart-box-median" style={{ left: position(row.median) }} /></span><b>{formatNumber(row.median)}</b></div>; })}<small className="chart-truncation">Whisker: min–max · hộp: Q1–Q3 · vạch: median.</small></div>;
  }

  if (chartSpec.chart_type === "heatmap") {
    const xName = querySpec.dimensions[0]; const yName = querySpec.dimensions[1];
    const xValues = [...new Set(rows.map((row) => String(row[xName] ?? "-")))]; const yValues = [...new Set(rows.map((row) => String(row[yName] ?? "-")))];
    const lookup = new Map(rows.map((row) => [`${String(row[xName] ?? "-")}\u0000${String(row[yName] ?? "-")}`, numeric(row.value) ?? 0]));
    return <div className="chart-heatmap-wrap"><div className="chart-heatmap" role="grid" style={{ gridTemplateColumns: `minmax(90px, auto) repeat(${yValues.length}, minmax(68px, 1fr))` }}><span className="heatmap-corner">{xName} \ {yName}</span>{yValues.map((label) => <b key={label} title={label}>{label}</b>)}{xValues.flatMap((xLabel) => [<b key={`row-${xLabel}`} title={xLabel}>{xLabel}</b>, ...yValues.map((yLabel) => { const value = lookup.get(`${xLabel}\u0000${yLabel}`) ?? 0; return <span role="gridcell" key={`${xLabel}-${yLabel}`} className="heatmap-cell" style={{ "--heat": Math.max(value / max, 0.04) } as CSSProperties} title={`${xLabel} · ${yLabel}: ${formatNumber(value)}`}>{formatNumber(value)}</span>; })])}</div><small className="chart-truncation">Màu đậm hơn thể hiện giá trị tổng hợp lớn hơn.</small></div>;
  }

  if (matrixMode) {
    const xValues = [...new Set(rows.map((row) => String(row.x ?? "-")))];
    const yValues = [...new Set(rows.map((row) => String(row.y ?? "-")))];
    const lookup = new Map(rows.map((row) => [`${String(row.x ?? "-")}\u0000${String(row.y ?? "-")}`, numeric(row.value) ?? 0]));
    const correlation = chartSpec.chart_type === "correlation_heatmap";
    return <div className="chart-heatmap-wrap"><div className={`chart-heatmap ${correlation ? "correlation-matrix" : "missing-matrix"}`} role="grid" style={{ gridTemplateColumns: `minmax(90px, auto) repeat(${yValues.length}, minmax(68px, 1fr))` }}><span className="heatmap-corner">Cột \ Cột</span>{yValues.map((label) => <b key={label} title={label}>{label}</b>)}{xValues.flatMap((xLabel) => [<b key={`row-${xLabel}`} title={xLabel}>{xLabel}</b>, ...yValues.map((yLabel) => { const value = lookup.get(`${xLabel}\u0000${yLabel}`) ?? 0; const intensity = correlation ? Math.abs(value) : Math.abs(value) / 100; return <span role="gridcell" key={`${xLabel}-${yLabel}`} className={`heatmap-cell ${correlation && value < 0 ? "negative" : ""}`} style={{ "--heat": Math.max(Math.min(intensity, 1), 0.04) } as CSSProperties} title={`${xLabel} · ${yLabel}: ${formatNumber(value)}`}>{formatNumber(value)}</span>; })])}</div><small className="chart-truncation">{correlation ? "Pearson r tổng hợp; màu âm biểu thị tương quan nghịch. Tương quan không chứng minh nhân quả." : "Mỗi ô là tỷ lệ % hai cột cùng thiếu; không hiển thị từng dòng dữ liệu."}</small></div>;
  }

  if (chartSpec.chart_type === "violin") {
    const groups = [...new Set(rows.map((row) => String(row.group_label ?? "Tổng thể")))];
    return <div className="chart-violin-list" role="img" aria-label={title || "Violin plot tổng hợp"}>{groups.map((group) => { const groupRows = rows.filter((row) => String(row.group_label ?? "Tổng thể") === group); const localMax = Math.max(...groupRows.map((row) => numeric(row.value) ?? 0), 1); return <div className="chart-violin-row" key={group}><b className="truncate" title={group}>{group}</b><div className="chart-violin-shape">{groupRows.map((row, index) => { const value = numeric(row.value) ?? 0; const half = Math.max(value / localMax * 48, 1); return <span key={index} className="chart-violin-bin" style={{ width: `${half * 2}%` }} title={`${formatNumber(Number(row.bin_start))}–${formatNumber(Number(row.bin_end))}: ${formatNumber(value)}`} />; })}</div></div>; })}<small className="chart-truncation">Hình violin được dựng từ bin count tổng hợp, không phải raw points.</small></div>;
  }

  if (chartSpec.chart_type === "donut") {
    const positiveRows = rows.map((row) => ({ row, value: Math.max(numeric(row.value) ?? 0, 0) })).filter((item) => item.value > 0);
    const total = positiveRows.reduce((sum, item) => sum + item.value, 0);
    if (!total) return <div className="chart-empty-canvas" role="status">Không có giá trị dương để vẽ Donut.</div>;
    const colors = ["#3156d9", "#5f7ceb", "#80a2ff", "#25a989", "#f0a43a", "#d96570", "#8b6bd6", "#4aa3b8", "#7d9b3a", "#d47db1", "#687386", "#9b7653"];
    let cursor = 0;
    const stops = positiveRows.map((item, index) => { const start = cursor; cursor += item.value / total * 100; return `${colors[index % colors.length]} ${start}% ${cursor}%`; });
    return <div className="chart-donut-wrap"><div className="chart-donut" role="img" aria-label={title || "Donut chart"} style={{ background: `conic-gradient(${stops.join(", ")})` }}><span><b>{formatNumber(total)}</b><small>Tổng</small></span></div><div className="chart-donut-legend">{positiveRows.map((item, index) => <div key={index}><i style={{ background: colors[index % colors.length] }} /><span className="truncate" title={rowLabel(item.row, querySpec)}>{rowLabel(item.row, querySpec)}</span><b>{formatNumber(item.value / total * 100)}%</b></div>)}</div></div>;
  }

  if (chartSpec.chart_type === "table") {
    return <div className="table-wrap chart-result-table"><table><thead><tr>{result.columns.map((name) => <th key={name}>{name === "value" ? "Kết quả" : name}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{result.columns.map((name) => <td key={name}>{name === "value" ? formatNumber(Number(row[name])) : String(row[name] ?? "-")}</td>)}</tr>)}</tbody></table></div>;
  }

  if (chartSpec.chart_type === "kpi") {
    return <div className="chart-kpi"><span>Giá trị tổng hợp</span><strong>{formatNumber(Number(rows[0]?.value ?? 0))}</strong><small>{result.row_count} kết quả</small></div>;
  }

  if (chartSpec.chart_type === "line") {
    const width = 720;
    const height = 220;
    if (forecastMode) {
      const domainValues = rows.flatMap((row) => [numeric(row.value), numeric(row.lower), numeric(row.upper)]).filter((value): value is number => value !== null);
      const domainMin = Math.min(...domainValues, 0); const domainMax = Math.max(...domainValues, 1); const domainSpread = Math.max(domainMax - domainMin, 1);
      const xAt = (index: number) => index / Math.max(rows.length - 1, 1) * width;
      const yAt = (value: number) => height - (value - domainMin) / domainSpread * (height - 26) - 12;
      const actualIndexes = rows.map((row, index) => row.series === "actual" ? index : -1).filter((index) => index >= 0);
      const forecastIndexes = rows.map((row, index) => row.series === "forecast" ? index : -1).filter((index) => index >= 0);
      const lastActual = actualIndexes.at(-1);
      const forecastLineIndexes = lastActual === undefined ? forecastIndexes : [lastActual, ...forecastIndexes];
      const linePoints = (indexes: number[]) => indexes.map((index) => `${xAt(index)},${yAt(numeric(rows[index].value) ?? 0)}`).join(" ");
      const band = forecastIndexes.length ? [...forecastIndexes.map((index) => `${xAt(index)},${yAt(numeric(rows[index].upper) ?? numeric(rows[index].value) ?? 0)}`), ...forecastIndexes.slice().reverse().map((index) => `${xAt(index)},${yAt(numeric(rows[index].lower) ?? numeric(rows[index].value) ?? 0)}`)].join(" ") : "";
      return <div className="chart-line-wrap chart-forecast-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title || "Biểu đồ dự báo"} className="chart-line-svg">{band && <polygon points={band} className="chart-forecast-band" />}{actualIndexes.length > 0 && <polyline points={linePoints(actualIndexes)} className="chart-actual-line" fill="none" strokeWidth="3" />}{forecastLineIndexes.length > 0 && <polyline points={linePoints(forecastLineIndexes)} className="chart-forecast-line" fill="none" strokeWidth="3" strokeDasharray="8 5" />}{rows.map((row, index) => { const value = numeric(row.value); if (value === null) return null; return <circle className={row.series === "forecast" ? "forecast-point" : "actual-point"} key={index} cx={xAt(index)} cy={yAt(value)} r="3"><title>{`${rowLabel(row, querySpec)} · ${row.series === "forecast" ? "Dự báo" : "Thực tế"}: ${formatNumber(value)}`}</title></circle>; })}</svg><div className="chart-forecast-legend"><span><i className="actual" />Thực tế</span><span><i className="forecast" />Dự báo</span><span><i className="interval" />Khoảng dự báo {Math.round((querySpec.confidence_level ?? 0.95) * 100)}%</span></div><div className="chart-axis-labels">{rows.map((row, index) => <span key={index} title={rowLabel(row, querySpec)}>{rowLabel(row, querySpec)}</span>)}</div>{result.row_count > rows.length && <small className="chart-truncation">Hiển thị {rows.length}/{result.row_count} điểm gần nhất.</small>}</div>;
    }
    const spread = Math.max(max - min, 1);
    const points = values.map((value, index) => Number.isFinite(value) ? `${(index / Math.max(values.length - 1, 1)) * width},${height - ((value - min) / spread) * (height - 26) - 12}` : null).filter((point): point is string => Boolean(point)).join(" ");
    return <div className="chart-line-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title || "Biểu đồ đường"} className="chart-line-svg"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{values.map((value, index) => { if (!Number.isFinite(value)) return null; const x = (index / Math.max(values.length - 1, 1)) * width; const y = height - ((value - min) / spread) * (height - 26) - 12; return <circle key={index} cx={x} cy={y} r="4"><title>{`${rowLabel(rows[index], querySpec)}: ${formatNumber(value)}`}</title></circle>; })}</svg><div className="chart-axis-labels">{rows.map((row, index) => <span key={index} title={rowLabel(row, querySpec)}>{rowLabel(row, querySpec)}</span>)}</div>{result.row_count > rows.length && <small className="chart-truncation">Hiển thị {rows.length}/{result.row_count} điểm.</small>}</div>;
  }

  const maxAbsolute = Math.max(...finiteValues.map(Math.abs), 1);
  const percentMetric = ["missing_bar", "outlier"].includes(chartSpec.chart_type);
  return <div className="chart-bars chart-result-bars">{rows.map((row, index) => { const value = Number(row.value); return <div className="bar-row" key={index}><span className="truncate" title={rowLabel(row, querySpec)}>{rowLabel(row, querySpec)}</span><span className="bar-track chart-diverging-track"><i className="chart-zero-line" /><span className={`bar-fill ${value < 0 ? "negative" : ""}`} style={divergingBarStyle(value, maxAbsolute)} /></span><b>{Number.isFinite(value) ? `${formatNumber(value)}${percentMetric ? "%" : ""}` : "-"}</b></div>; })}{result.row_count > rows.length && <small className="chart-truncation">Hiển thị {rows.length}/{result.row_count} nhóm.</small>}</div>;
}

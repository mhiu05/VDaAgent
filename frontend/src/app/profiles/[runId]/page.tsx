"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getProfile } from "@/lib/api";
import { formatNumber, formatPercent, toTitle } from "@/lib/format";
import { MarkdownContent } from "@/components/markdown";
import { EmptyState, ErrorNotice, LoadingBlock, Metric, Notice, PageHeader, StatusBadge } from "@/components/ui";
import type { ColumnStat } from "@/lib/types";

function TopValues({ stat }: { stat: ColumnStat }) {
  if (stat.pii_masked) return <span className="chip pii">Masked PII</span>;
  if (!stat.top_k_values) return <span className="muted">—</span>;
  const entries = Array.isArray(stat.top_k_values)
    ? stat.top_k_values.map((item) => typeof item === "object" && item ? JSON.stringify(item) : String(item))
    : typeof stat.top_k_values === "object" ? Object.entries(stat.top_k_values as Record<string, unknown>).slice(0, 3).map(([key, value]) => `${key}: ${String(value)}`) : [String(stat.top_k_values)];
  return <div className="chip-list">{entries.slice(0, 3).map((value, index) => <span className="chip" key={`${value}-${index}`}>{value}</span>)}</div>;
}

function Distribution({ stat, totalRows }: { stat: ColumnStat; totalRows?: number | null }) {
  if (stat.pii_masked || !stat.top_k_values || typeof stat.top_k_values !== "object") return <span className="muted">Không có phân phối an toàn để hiển thị.</span>;
  const entries = (Array.isArray(stat.top_k_values)
    ? stat.top_k_values
      .filter((item): item is { value?: unknown; count?: unknown } => typeof item === "object" && item !== null)
      .map((item) => ({ label: String(item.value ?? "—"), count: Number(item.count) }))
    : Object.entries(stat.top_k_values as Record<string, unknown>)
      .map(([label, count]) => ({ label, count: Number(count) })))
    .filter((entry) => Number.isFinite(entry.count))
    .slice(0, 5);
  if (!entries.length) return <span className="muted">Chưa có phân phối category an toàn để hiển thị.</span>;
  const max = Math.max(...entries.map((entry) => entry.count), 1);
  const total = Number(totalRows) || Number(stat.row_count) || null;
  return <div className="chart-bars">{entries.map((entry) => <div className="bar-row" key={entry.label}><span className="truncate" title={entry.label}>{entry.label}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${(entry.count / max) * 100}%` }} /></span><b>{formatNumber(entry.count)} {total ? <small>({formatPercent(entry.count / total, 2)})</small> : null}</b></div>)}</div>;
}

function metricPercent(value: number | null | undefined, ratio: boolean): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const percent = ratio && Math.abs(value) <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, percent));
}

function MetricChart({ title, columns, metric, ratio = false, warning = false }: {
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
  return <section className="panel metric-chart"><div className="panel-title"><div><h2>{title}</h2><small>Top {rows.length} cột · thang đo 0–100%</small></div><span className="chip">Visualize</span></div><div className="chart-bars">{rows.map((row) => <div className="bar-row" key={row.name}><span className="truncate" title={row.name}>{row.name}</span><span className="bar-track"><span className={`bar-fill ${warning ? "warning" : ""}`} style={{ width: `${row.value}%` }} /></span><b>{formatNumber(row.value, 1)}%</b></div>)}</div><div className="metric-chart-scale"><span>0%</span><span>100%</span></div></section>;
}

function correlationStrength(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 0.8) return "Rất mạnh";
  if (absolute >= 0.6) return "Mạnh";
  if (absolute >= 0.4) return "Vừa";
  if (absolute >= 0.2) return "Yếu";
  return "Rất yếu";
}

function CorrelationPanel({ matrix }: { matrix: Record<string, Record<string, number>> }) {
  const pairs = Object.entries(matrix)
    .flatMap(([left, values]) => Object.entries(values).filter(([right]) => left < right).map(([right, value]) => ({ left, right, value: Number(value) })))
    .filter((pair) => Number.isFinite(pair.value))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value));

  if (!pairs.length) return <p className="muted">Không đủ cột numeric để tính correlation.</p>;

  return <>
    <div className="correlation-legend"><span><i className="correlation-swatch positive" /> Dương</span><span><i className="correlation-swatch negative" /> Âm</span><span>Gần 0 = ít liên hệ tuyến tính</span></div>
    <div className="correlation">{pairs.map((pair) => <div className={`correlation-cell ${pair.value >= 0 ? "positive" : "negative"}`} key={`${pair.left}-${pair.right}`}><div className="correlation-pair" title={`${pair.left} × ${pair.right}`}>{pair.left} <span>×</span> {pair.right}</div><div className="correlation-score"><b>r = {formatNumber(pair.value, 3)}</b><small>{pair.value >= 0 ? "Dương" : "Âm"} · {correlationStrength(pair.value)}</small></div></div>)}</div>
    <p className="muted correlation-note">Pearson r chỉ phản ánh tương quan tuyến tính; không chứng minh quan hệ nhân quả.</p>
  </>;
}

export default function ProfilePage() {
  const { runId } = useParams<{ runId: string }>();
  const profile = useQuery({
    queryKey: ["profile", runId], queryFn: ({ signal }) => getProfile(runId, signal), enabled: Boolean(runId),
    refetchInterval: (query) => ["created", "queued", "running", "resuming"].includes(query.state.data?.status || "") ? 3_000 : false,
  });
  if (profile.isLoading) return <LoadingBlock label="Đang tải profile report…" />;
  if (profile.isError) return <ErrorNotice error={profile.error} retry={() => profile.refetch()} />;
  if (!profile.data) return <EmptyState title="Không có dữ liệu profile" detail="Profile run không tồn tại hoặc API chưa trả dữ liệu." />;
  const data = profile.data;
  const columns = Object.values(data.column_stats);
  const pii = data.proposals.pii?.filter((proposal) => proposal.status !== "rejected") ?? [];
  const hasReview = data.pending_proposals > 0;
  return <>
    <PageHeader eyebrow={`Profile run · ${data.profile_run_id}`} title={data.dataset_name || "Profile report"} description="Các số liệu đến trực tiếp từ compute engine. Evidence proposal được giữ riêng để analyst review." action={<>{hasReview ? <Link href={`/profiles/${runId}/review`} className="button primary">Review {data.pending_proposals} đề xuất</Link> : <Link href={`/analyses/new?runId=${encodeURIComponent(runId)}`} className="button primary">Start analysis</Link>}<Link href={`/profiles/${runId}/analysis`} className="button secondary">Phân tích</Link></>} />
    {data.error && <Notice tone="warning"><b>Pipeline báo lỗi.</b><p>{data.error}</p></Notice>}
    <section className="panel compact" style={{ marginBottom: 18 }}><div className="inline-actions"><StatusBadge status={data.status} /><span className="chip">{data.scan_mode || "—"} scan {data.is_approximate && "· sampled"}</span>{data.is_approximate && <span className="chip">≈ Có uncertainty</span>}<span className="muted">Seed: {data.random_seed ?? "—"}</span></div></section>
    <section className="grid four"><Metric label="Số dòng" value={formatNumber(data.row_count)} approximate={data.is_approximate} detail={data.is_approximate ? "Ước lượng từ sample" : "Full compute scan"} /><Metric label="Số cột" value={formatNumber(data.column_count)} detail={`${pii.length} tín hiệu PII`} /><Metric label="Đề xuất chờ review" value={formatNumber(data.pending_proposals)} detail="Không auto-confirm PII/key" /><Metric label="Quasi-identifiers" value={formatNumber(data.quasi_identifiers.length)} detail={data.quasi_identifiers.slice(0, 2).join(", ") || "Không phát hiện"} /></section>
    <div className="grid two" style={{ marginTop: 18 }}>
      <section className="panel"><div className="panel-title"><h2>Rủi ro & privacy</h2><span className="chip pii">PII guarded</span></div>{data.risk_warnings.length ? <ul className="warning-list">{data.risk_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p className="muted">Không có cảnh báo rủi ro từ pipeline.</p>}<div className="chip-list" style={{ marginTop: 14 }}>{pii.map((proposal) => <span className="chip pii" key={proposal.id}>{proposal.column_name || proposal.columns?.join(", ")}: {proposal.pii_type || proposal.proposed_type || "PII candidate"}</span>)}</div></section>
      <section className="panel"><div className="panel-title"><h2>Provenance</h2><small>Reproducible run</small></div><dl className="key-value"><dt>Run version</dt><dd>{data.version ?? "—"}</dd><dt>Scan mode</dt><dd>{data.scan_mode || "—"}</dd><dt>Source engine</dt><dd>Compute engine + evidence-first proposals</dd><dt>Executed plan</dt><dd className="truncate">{data.executed_query || "Không được ghi nhận"}</dd></dl></section>
    </div>
    {data.narrative_report && <section className="panel" style={{ marginTop: 18 }}><div className="panel-title"><h2>Tóm tắt agent</h2><small>Chỉ diễn giải metric đã kiểm chứng</small></div><MarkdownContent text={data.narrative_report} className="report report-markdown" /></section>}
    <section className="panel" style={{ marginTop: 18 }}><div className="panel-title"><div><h2>Column profile</h2><small>Top values bị ẩn với cột PII.</small></div><span className="chip">{columns.length} columns</span></div><div className="table-wrap"><table><thead><tr><th>Cột</th><th>Kiểu</th><th>Null</th><th>Cardinality</th><th>Uniqueness</th><th>Numeric summary</th><th>Top values</th></tr></thead><tbody>{columns.map((stat) => <tr key={stat.column_name}><td><b>{stat.column_name}</b>{stat.pii_masked && <><br /><span className="chip pii">PII masked</span></>}</td><td>{stat.dtype || "—"}</td><td>{formatPercent(stat.null_pct)}<br /><small>{formatNumber(stat.null_count)} null</small></td><td>{formatNumber(stat.cardinality)}</td><td>{formatPercent(stat.uniqueness_ratio)}</td><td>{stat.mean !== null && stat.mean !== undefined ? <><b>{formatNumber(stat.mean)}</b> mean<br /><small>min {formatNumber(stat.min_value)} · max {formatNumber(stat.max_value)} · {formatNumber(stat.outlier_count)} outliers</small></> : <small>Length: {formatNumber(stat.min_length)}–{formatNumber(stat.max_length)}</small>}</td><td><TopValues stat={stat} /></td></tr>)}</tbody></table></div></section>
    <div className="grid two" style={{ marginTop: 18 }}><MetricChart title="Tỷ lệ null theo cột" columns={columns} metric="null_pct" warning /><MetricChart title="Tỷ lệ unique theo cột" columns={columns} metric="uniqueness_ratio" ratio /></div>
    <div className="grid two" style={{ marginTop: 18 }}><section className="panel"><div className="panel-title"><h2>Phân phối</h2><small>Top-k non-PII · tỷ lệ trên toàn bộ dòng</small></div>{columns.filter((stat) => !stat.pii_masked).slice(0, 3).map((stat) => <div className="distribution-column" key={stat.column_name}><h3>{stat.column_name}</h3><Distribution stat={stat} totalRows={data.row_count} /></div>)}</section><section className="panel"><div className="panel-title"><h2>Correlation</h2><small>Pearson r · numeric columns</small></div><CorrelationPanel matrix={data.correlation_matrix} /></section></div>
  </>;
}

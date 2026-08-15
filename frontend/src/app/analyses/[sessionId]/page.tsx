"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  approveAnalysisContext,
  createAnalysisContext,
  executeAnalysis,
  getAnalysis,
  runAnalysisQualityGate,
} from "@/lib/api";
import type { AnalysisExecution, QuerySpec } from "@/lib/analysis-types";
import { ErrorNotice, LoadingBlock, Notice, PageHeader, StatusBadge } from "@/components/ui";

const split = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const formatNumber = (value: unknown) => typeof value === "number"
  ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)
  : String(value ?? "—");

type ExplorationMode = "compare" | "leaders" | "laggards";

const explorationPresets: Array<{ mode: ExplorationMode; icon: string; title: string; description: string }> = [
  { mode: "compare", icon: "◫", title: "So sánh nhóm", description: "Đặt cạnh nhau theo dimension đã duyệt." },
  { mode: "leaders", icon: "↗", title: "Tìm nhóm dẫn đầu", description: "Xếp hạng top nhóm theo metric." },
  { mode: "laggards", icon: "↘", title: "Tìm nhóm thấp nhất", description: "Phát hiện nhóm cần chú ý." },
];

export default function AnalysisWorkspacePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const session = useQuery({ queryKey: ["analysis", sessionId], queryFn: ({ signal }) => getAnalysis(sessionId, signal), enabled: Boolean(sessionId) });
  const [rowGrain, setRowGrain] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [measures, setMeasures] = useState("");
  const [column, setColumn] = useState("");
  const [aggregate, setAggregate] = useState<QuerySpec["aggregate"]>("count");
  const [groupBy, setGroupBy] = useState("");
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const [filterColumn, setFilterColumn] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [explorationMode, setExplorationMode] = useState<ExplorationMode>("compare");
  const [execution, setExecution] = useState<AnalysisExecution | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  if (session.isLoading) return <LoadingBlock label="Đang mở không gian phân tích…" />;
  if (session.isError || !session.data) return <ErrorNotice error={session.error || new Error("Không tìm thấy session.")} retry={() => session.refetch()} />;

  const data = session.data;
  const context = data.context;
  const approvedDimensions = context?.context.dimensions ?? [];
  const approvedMeasures = context?.context.measures ?? [];
  const countableColumns = [...new Set([
    ...(context?.context.keys ?? []),
    ...approvedDimensions,
    ...approvedMeasures,
  ])];
  const columnOptions = aggregate === "count_distinct" ? countableColumns : approvedMeasures;
  const canExplore = context?.status === "approved" && data.quality_gate?.decision !== "blocked";

  function applyPreset(mode: ExplorationMode) {
    setExplorationMode(mode);
    if (!groupBy && approvedDimensions[0]) setGroupBy(approvedDimensions[0]);
    if (mode === "compare") {
      setAggregate(approvedMeasures[0] ? "mean" : "count");
      setColumn(approvedMeasures[0] || "");
      setSort("desc");
    } else {
      setAggregate("count");
      setColumn("");
      setSort(mode === "leaders" ? "desc" : "asc");
    }
  }

  async function saveContext(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await createAnalysisContext(sessionId, {
        row_grain: rowGrain,
        keys: [],
        dimensions: split(dimensions),
        measures: split(measures),
        ignored_columns: [],
        limitations: [],
      });
      await approveAnalysisContext(sessionId, saved!.id);
      await runAnalysisQualityGate(sessionId);
      await session.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Không thể lưu context."));
    } finally {
      setBusy(false);
    }
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!context) return;
    setBusy(true);
    setError(null);
    try {
      setExecution(await executeAnalysis(sessionId, context.id, {
        aggregate,
        column: column || undefined,
        dimensions: split(groupBy),
        filters: filterColumn && filterValue ? [{ column: filterColumn, operator: "eq", value: filterValue }] : [],
        limit: 100,
        sort,
      }));
      await session.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Không thể chạy khám phá dữ liệu."));
    } finally {
      setBusy(false);
    }
  }

  const resultSummary = execution ? (() => {
    const rows = execution.result.data;
    const values = rows.map((row) => Number(row.value)).filter(Number.isFinite);
    const groupColumn = execution.query_spec.dimensions[0];
    const sorted = [...rows].sort((a, b) => Number(b.value) - Number(a.value));
    const leader = sorted[0];
    const lowest = sorted[sorted.length - 1];
    return {
      leader: leader && groupColumn ? `${String(leader[groupColumn] ?? "(trống)")} · ${formatNumber(leader.value)}` : "Toàn bộ dữ liệu",
      lowest: lowest && groupColumn ? `${String(lowest[groupColumn] ?? "(trống)")} · ${formatNumber(lowest.value)}` : formatNumber(values[0]),
      spread: values.length > 1 ? formatNumber(Math.max(...values) - Math.min(...values)) : "—",
    };
  })() : null;

  return <>
    <PageHeader eyebrow={`Phiên phân tích · ${data.id}`} title={data.goal} description="Không gian dựa trên evidence: context → quality gate → câu trả lời khám phá." action={<div className="inline-actions"><Link className="button secondary" href={data.source?.profile_run_id ? `/profiles/${encodeURIComponent(data.source.profile_run_id)}` : "/reports"}>Quay lại báo cáo</Link><StatusBadge status={data.status} /></div>} />
    {error && <ErrorNotice error={error} />}

    <div className="grid two">
      <section className="panel">
        <div className="panel-title"><h2>1. Context</h2><small>{context?.status || "chờ duyệt"}</small></div>
        {!context || context.status !== "approved" ? <form className="form-stack context-form" onSubmit={saveContext}>
          <div className="context-form-intro"><b>Context giúp hệ thống hiểu đúng câu hỏi của bạn</b><p>Hãy mô tả một dòng đại diện cho gì, chia dữ liệu theo cột nào và phép tính sẽ dùng cột nào.</p></div>
          <label className="context-field"><span className="context-field-label">Row grain <small>Cấp độ của một dòng dữ liệu</small></span><input value={rowGrain} onChange={(event) => setRowGrain(event.target.value)} placeholder="Ví dụ: một dòng = một order" /></label>
          <label className="context-field"><span className="context-field-label">Dimensions <small>Cột dùng để chia nhóm và so sánh</small></span><input value={dimensions} onChange={(event) => setDimensions(event.target.value)} placeholder="Ví dụ: city, status" /></label>
          <label className="context-field"><span className="context-field-label">Measures <small>Cột dùng để tính tổng, mean hoặc median</small></span><input value={measures} onChange={(event) => setMeasures(event.target.value)} placeholder="Ví dụ: price, freight_value" /></label>
          <button className="button primary" disabled={busy}>Duyệt context & chạy quality gate</button>
        </form> : <dl className="key-value"><dt>Grain</dt><dd>{context.context.row_grain || "Chưa chỉ định"}</dd><dt>Dimensions</dt><dd>{context.context.dimensions.join(", ") || "—"}</dd><dt>Measures</dt><dd>{context.context.measures.join(", ") || "—"}</dd></dl>}
      </section>

      <section className="panel">
        <div className="panel-title"><h2>2. Quality gate</h2><small>{data.quality_gate?.decision || "chưa chạy"}</small></div>
        {data.quality_gate ? data.quality_gate.issues.length ? <ul className="warning-list">{data.quality_gate.issues.map((issue) => <li key={issue.id}><b>{issue.severity}</b> — {issue.message}</li>)}</ul> : <Notice tone="success">Không phát hiện quality issue cho context hiện tại.</Notice> : <p className="muted">Duyệt context để kiểm tra scope, sampling và metric readiness.</p>}
      </section>
    </div>

    <section className="panel exploration-panel" style={{ marginTop: 18 }}>
      <div className="panel-title exploration-heading"><div><p className="eyebrow">3 · TƯƠNG TÁC VỚI DỮ LIỆU</p><h2>Khám phá dữ liệu</h2><p>Đây là lớp trả lời câu hỏi theo nhóm — khác với báo cáo profiling chỉ tóm tắt toàn bảng.</p></div><small>Bounded aggregate · không trả raw row</small></div>
      <div className="exploration-difference"><div><b>Báo cáo trước</b><span>mean · min · max · missingness của từng cột</span></div><strong>→</strong><div><b>Khám phá ở đây</b><span>nhóm nào khác biệt, dẫn đầu/thấp nhất và thay đổi khi lọc</span></div></div>
      {canExplore ? <>
        <div className="exploration-presets">{explorationPresets.map((preset) => <button type="button" key={preset.mode} className={`exploration-preset${explorationMode === preset.mode ? " selected" : ""}`} onClick={() => applyPreset(preset.mode)}><span>{preset.icon}</span><b>{preset.title}</b><small>{preset.description}</small></button>)}</div>
        {approvedDimensions.length === 0 ? <Notice tone="warning">Context chưa có dimension. Hãy tạo lại context với ít nhất một cột phân loại, khu vực hoặc thời gian để có thể so sánh các nhóm.</Notice> : <form className="exploration-form" onSubmit={run}>
          <label><span>Nhóm theo</span><select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="">Không chia nhóm</option>{approvedDimensions.map((item) => <option key={item} value={item}>{item}</option>)}</select><small>Ví dụ: city, seller_id, order_date</small></label>
          <label><span>Metric trả lời</span><select value={aggregate} onChange={(event) => { const next = event.target.value as QuerySpec["aggregate"]; setAggregate(next); if (next === "count") setColumn(""); }}>{<><option value="count">Số dòng</option><option value="count_distinct">Số giá trị khác nhau</option><option value="sum">Tổng</option><option value="mean">Trung bình</option><option value="median">Trung vị</option></>}</select></label>
          <label><span>Cột metric</span><select value={column} onChange={(event) => setColumn(event.target.value)} disabled={aggregate === "count"}><option value="">{aggregate === "count" ? "Không cần cột" : "Chọn cột đã duyệt"}</option>{columnOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><small>Chỉ dùng cột trong context</small></label>
          <label><span>Sắp xếp</span><select value={sort} onChange={(event) => setSort(event.target.value as "asc" | "desc")}><option value="desc">Cao → thấp</option><option value="asc">Thấp → cao</option></select></label>
          <label><span>Lọc một phân khúc <i>(tuỳ chọn)</i></span><select value={filterColumn} onChange={(event) => setFilterColumn(event.target.value)}><option value="">Không lọc</option>{[...new Set([...approvedDimensions, ...approvedMeasures])].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span>Giá trị lọc</span><input value={filterValue} onChange={(event) => setFilterValue(event.target.value)} disabled={!filterColumn} placeholder="Ví dụ: São Paulo" /></label>
          <button className="button primary exploration-submit" disabled={busy || (aggregate !== "count" && !column)}>Trả lời câu hỏi</button>
        </form>}
      </> : <p className="muted">Hoàn tất context và quality gate để bắt đầu khám phá theo nhóm.</p>}

      {execution && <div className="exploration-result">
        <div className="exploration-result-header"><div><p className="eyebrow">KẾT QUẢ KHÁM PHÁ</p><h3>{execution.query_spec.dimensions[0] ? `Phân bố ${execution.query_spec.aggregate} theo ${execution.query_spec.dimensions[0]}` : "Tổng quan theo bộ lọc đã chọn"}</h3></div><span>{execution.result.row_count} nhóm</span></div>
        {resultSummary && <div className="exploration-insights"><div><small>Nhóm dẫn đầu</small><b>{resultSummary.leader}</b></div><div><small>Nhóm thấp nhất</small><b>{resultSummary.lowest}</b></div><div><small>Khoảng cách max − min</small><b>{resultSummary.spread}</b></div></div>}
        <div className="table-wrap"><table><thead><tr>{execution.result.columns.map((name) => <th key={name}>{name === "value" ? "Kết quả" : name}</th>)}</tr></thead><tbody>{execution.result.data.map((row, index) => <tr key={index}>{execution.result.columns.map((name) => <td key={name}>{name === "value" ? formatNumber(row[name]) : String(row[name] ?? "—")}</td>)}</tr>)}</tbody></table></div>
        <p className="muted exploration-evidence">Evidence {execution.id} · hash {execution.result_hash.slice(0, 12)} · {execution.duration_ms}ms · kết quả deterministic</p>
      </div>}
    </section>
  </>;
}

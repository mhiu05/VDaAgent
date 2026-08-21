"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ensureExplorerSession, getProfileReportDraft, pinChartToReport, previewExplorer, promoteExplorerPreview } from "@/lib/api";
import type { AnalysisExecution, QuerySpec } from "@/lib/analysis-types";
import type { Profile } from "@/lib/types";
import { formatNumber } from "@/lib/format";
import { EmptyState, ErrorNotice, LoadingBlock, Notice } from "@/components/ui";

type Props = { runId: string; profile: Profile; onExplain: (execution: AnalysisExecution) => void };

const AGGREGATES: Array<{ value: QuerySpec["aggregate"]; label: string }> = [
  { value: 'count', label: 'Số dòng' }, { value: 'count_distinct', label: 'Đếm khác biệt' },
  { value: 'sum', label: 'Tổng' }, { value: 'mean', label: 'Trung bình' }, { value: 'median', label: 'Trung vị' },
];

function previewErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Không thể chạy Preview.";
  if (message.includes("explorer_timeout")) {
    return "Nguồn dữ liệu cần thêm thời gian để chuẩn bị. Hãy thử lại; Preview có thể chờ tối đa 60 giây cho nguồn lưu trữ từ xa.";
  }
  if (message.includes("explorer_source_unavailable")) {
    return "Chưa thể tải nguồn dữ liệu từ kho lưu trữ. Hãy kiểm tra kết nối nguồn rồi thử lại Preview.";
  }
  return message;
}

function promoteErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Không thể chạy kết quả chính thức.";
  if (message.includes("context_stale")) {
    return "Context của Explorer vừa thay đổi. Hãy chạy lại Preview để tạo kết quả mới trước khi chạy kết quả chính thức.";
  }
  return message;
}

function translateLimitation(text: string) {
  if (text.includes("Preview uses a reservoir sample")) {
    return text.replace(/Preview uses a reservoir sample \(([^)]+)\); confirm the result before using it as official evidence./, "Kết quả xem trước sử dụng dữ liệu mẫu; hãy chạy kết quả chính thức trước khi dùng làm minh chứng.");
  }
  return text;
}

function translateSummary(text: string) {
  if (!text) return text;
  return text
    .replace(/Count rows/gi, "Đếm số dòng")
    .replace(/showing up to (\d+) group\(s\)/gi, "hiển thị tối đa $1 nhóm");
}

function ResultTable({ execution }: { execution: AnalysisExecution }) {
  const max = Math.max(...execution.result.data.map((row) => Number(row.value) || 0), 1);
  return <section className="panel command-result" aria-live="polite">
    <div className="panel-title"><div><h2>{execution.execution_kind === "preview" ? "Kết quả xem trước" : "Kết quả chính thức"}</h2><small>{execution.query_summary ? translateSummary(execution.query_summary) : "Truy vấn tổng hợp có giới hạn"}</small></div><span className={execution.execution_kind === "preview" ? "chip warning" : "chip"}>{execution.execution_kind === "preview" ? "Xem trước" : "Chính thức"}</span></div>
    {execution.limitations.length > 0 && <Notice tone={execution.execution_kind === "preview" ? "warning" : "info"}>{execution.limitations.map(translateLimitation).join(" ")}</Notice>}
    <div className="command-result-chart" role="img" aria-label="Bar chart has matching data table below">
      {execution.result.data.slice(0, 12).map((row, index) => <div className="bar-row" key={index}><span className="truncate">{String(execution.query_spec.dimensions[0] ? row[execution.query_spec.dimensions[0]] ?? "-" : "Kết quả")}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${((Number(row.value) || 0) / max) * 100}%` }} /></span><b>{formatNumber(Number(row.value))}</b></div>)}
    </div>
    <div className="table-wrap"><table><thead><tr>{execution.result.columns.map((name) => <th key={name} style={{ textTransform: 'uppercase' }}>{name === "value" ? "Kết quả" : name}</th>)}</tr></thead><tbody>{execution.result.data.map((row, index) => <tr key={index}>{execution.result.columns.map((name) => <td key={name}>{name === "value" ? formatNumber(Number(row[name])) : String(row[name] ?? "-")}</td>)}</tr>)}</tbody></table></div>
    <p className="muted">Minh chứng {execution.id} · hash {execution.result_hash.slice(0, 12)} · {execution.duration_ms ?? "-"}ms</p>
    {execution.execution_kind === "preview" && <p className="command-preview-guidance"><b>Bước tiếp theo:</b> Chỉnh Aggregate, Group by hoặc Filter ở panel bên trái, rồi nhấn <b>Chạy preview</b> để thử truy vấn khác; nhấn <b>Chạy kết quả chính thức</b> khi kết quả này đã đúng.</p>}
  </section>;
}

export function ExplorerTab({ runId, profile, onExplain }: Props) {
  const explorer = useQuery({ queryKey: ["command-center", runId, "explorer-session"], queryFn: () => ensureExplorerSession(runId) });
  const [aggregate, setAggregate] = useState<QuerySpec["aggregate"]>("count");
  const [dimension, setDimension] = useState("");
  const [column, setColumn] = useState("");
  const [filterColumn, setFilterColumn] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [execution, setExecution] = useState<AnalysisExecution | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);
  const context = explorer.data?.context;
  const dimensions = context?.context.dimensions ?? [];
  const measures = context?.context.measures ?? [];
  const query = useMemo<QuerySpec>(() => ({
    aggregate, column: aggregate === "count" ? undefined : column || undefined,
    dimensions: dimension ? [dimension] : [], filters: filterColumn && filterValue ? [{ column: filterColumn, operator: "eq", value: filterValue }] : [], limit: 50, sort: "desc",
  }), [aggregate, column, dimension, filterColumn, filterValue]);
  const preview = useMutation({
    mutationFn: async () => {
      if (!explorer.data) throw new Error("Explorer is not ready.");
      const next = new AbortController(); setController(next);
      try { return await previewExplorer(runId, query, next.signal); } finally { setController(null); }
    }, onSuccess: setExecution
  });
  const promote = useMutation({
    mutationFn: async () => {
      const contextId = execution?.context_version_id ?? explorer.data?.context?.id;
      if (!execution || !contextId) throw new Error("Preview is not ready.");
      const next = new AbortController(); setController(next);
      try { return await promoteExplorerPreview(runId, execution.id, contextId, next.signal); } finally { setController(null); }
    }, onSuccess: setExecution
  });
  const pin = useMutation({
    mutationFn: async () => {
      if (!execution || execution.execution_kind === "preview") throw new Error("Confirm the preview before pinning it.");
      const draft = await getProfileReportDraft(runId);
      return pinChartToReport(draft.id, execution.id);
    }
  });
  useEffect(() => () => controller?.abort(), [controller]);

  if (explorer.isLoading) return <LoadingBlock label="Đang tạo Explorer cho profile này..." />;
  if (explorer.isError) return <ErrorNotice error={explorer.error} retry={() => explorer.refetch()} />;
  if (!context) return <EmptyState title="Explorer chưa có context" detail="Mở lại tab để tạo semantic context từ profile đã review." />;
  const disabled = profile.status !== "completed" || preview.isPending || promote.isPending || (aggregate !== "count" && !column);

  return <section className="command-explorer">
    <header><h2>Khám phá dữ liệu</h2><p className='muted'>Tạo truy vấn thống kê an toàn mà không cần dùng SQL. Kết quả xem trước chỉ được tính trên một tập dữ liệu mẫu nhỏ; bạn cần chạy kết quả chính thức nếu muốn lưu lại làm minh chứng cho báo cáo.</p></header>
    {(dimensions.length === 0 && measures.length === 0) && <Notice tone='warning'>Không có cột an toàn trong context. Hãy review semantic type và PII trước khi chạy Explorer.</Notice>}
    <form className="panel command-query-form" onSubmit={(event) => { event.preventDefault(); preview.mutate(); }}>
      <label>Aggregate<select value={aggregate} onChange={(event) => setAggregate(event.target.value as QuerySpec["aggregate"])}>{AGGREGATES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
      <label>Measure<select value={column} disabled={aggregate === "count"} onChange={(event) => setColumn(event.target.value)}><option value="">{aggregate === "count" ? "Không cần cột" : "Chọn measure"}</option>{measures.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <label>Group by<select value={dimension} onChange={(event) => setDimension(event.target.value)}><option value="">Không chia nhóm</option>{dimensions.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <label>Filter column<select value={filterColumn} onChange={(event) => setFilterColumn(event.target.value)}><option value="">Không lọc</option>{[...dimensions, ...measures].map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <label>Filter value<input value={filterValue} disabled={!filterColumn} onChange={(event) => setFilterValue(event.target.value)} /></label>
      <div className="command-query-actions"><p className="muted">{execution?.query_summary ? translateSummary(execution.query_summary) : `Preview: ${query.aggregate}${query.column ? ` ${query.column}` : ""}${query.dimensions.length ? ` theo ${query.dimensions.join(", ")}` : ""} · tối đa 50 nhóm`}</p><button className="button primary" disabled={disabled}>{preview.isPending ? "Đang chuẩn bị nguồn…" : "Chạy preview"}</button>{controller && <button type="button" className="button secondary" onClick={() => controller.abort()}>Hủy request</button>}</div>
      {preview.isPending && <p className="command-query-progress" aria-live="polite">Đang tải và lấy mẫu dữ liệu. Với nguồn lưu trữ từ xa, thao tác này có thể mất đến 60 giây.</p>}
      {preview.isError && <section className="notice warning command-query-error" role="alert"><b>Preview chưa hoàn tất.</b><p>{previewErrorMessage(preview.error)}</p><button type="button" className="button secondary" onClick={() => preview.mutate()}>Thử lại preview</button></section>}
    </form>
    {execution && <div className="command-result-stack">
      {promote.isError && <section className="notice error command-promote-error" role="alert"><b>Chưa thể chạy kết quả chính thức.</b><p>{promoteErrorMessage(promote.error)}</p><button type="button" className="button secondary" onClick={() => promote.mutate()}>Thử chạy lại</button></section>}
      {pin.isError && <ErrorNotice error={pin.error} retry={() => pin.reset()} />}
      <ResultTable execution={execution} />
      <div className='inline-actions command-result-actions'>
        <button className='button secondary' type='button' onClick={() => onExplain(execution)}>Giải thích</button>
        {execution.execution_kind === 'preview' && <button className='button primary' type='button' onClick={() => promote.mutate()} disabled={promote.isPending}>{promote.isPending ? 'Đang chạy chính thức…' : 'Chạy kết quả chính thức'}</button>}
        <button className='button secondary' type='button' onClick={() => pin.mutate()} disabled={execution.execution_kind === 'preview' || pin.isPending}>{pin.isPending ? 'Đang ghim…' : 'Ghim vào báo cáo'}</button>
        {pin.isSuccess && <span className='chip'>Đã ghim vào báo cáo nháp</span>}
      </div>
    </div>}
  </section>;
}

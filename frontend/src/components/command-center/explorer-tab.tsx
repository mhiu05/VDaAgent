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

function ResultTable({ execution }: { execution: AnalysisExecution }) {
  const max = Math.max(...execution.result.data.map((row) => Number(row.value) || 0), 1);
  return <section className="panel command-result" aria-live="polite">
    <div className="panel-title"><div><h2>{execution.execution_kind === "preview" ? "Preview result" : "Official result"}</h2><small>{execution.query_summary || "Bounded deterministic aggregate"}</small></div><span className={execution.execution_kind === "preview" ? "chip warning" : "chip"}>{execution.execution_kind === "preview" ? "Preview" : "Official"}</span></div>
    {execution.limitations.length > 0 && <Notice tone={execution.execution_kind === "preview" ? "warning" : "info"}>{execution.limitations.join(" ")}</Notice>}
    <div className="command-result-chart" role="img" aria-label="Bar chart has matching data table below">
      {execution.result.data.slice(0, 12).map((row, index) => <div className="bar-row" key={index}><span className="truncate">{String(execution.query_spec.dimensions[0] ? row[execution.query_spec.dimensions[0]] ?? "-" : "Result")}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${((Number(row.value) || 0) / max) * 100}%` }} /></span><b>{formatNumber(Number(row.value))}</b></div>)}
    </div>
    <div className="table-wrap"><table><thead><tr>{execution.result.columns.map((name) => <th key={name}>{name === "value" ? "Ket qua" : name}</th>)}</tr></thead><tbody>{execution.result.data.map((row, index) => <tr key={index}>{execution.result.columns.map((name) => <td key={name}>{name === "value" ? formatNumber(Number(row[name])) : String(row[name] ?? "-")}</td>)}</tr>)}</tbody></table></div>
    <p className="muted">Evidence {execution.id} · hash {execution.result_hash.slice(0, 12)} · {execution.duration_ms ?? "-"}ms</p>
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
  const preview = useMutation({ mutationFn: async () => {
    if (!explorer.data) throw new Error("Explorer is not ready.");
    const next = new AbortController(); setController(next);
    try { return await previewExplorer(explorer.data.id, query, next.signal); } finally { setController(null); }
  }, onSuccess: setExecution });
  const promote = useMutation({ mutationFn: async () => {
    if (!explorer.data?.context || !execution) throw new Error("Preview is not ready.");
    const next = new AbortController(); setController(next);
    try { return await promoteExplorerPreview(explorer.data.id, execution.id, explorer.data.context.id, next.signal); } finally { setController(null); }
  }, onSuccess: setExecution });
  const pin = useMutation({ mutationFn: async () => {
    if (!execution || execution.execution_kind === "preview") throw new Error("Confirm the preview before pinning it.");
    const draft = await getProfileReportDraft(runId);
    return pinChartToReport(draft.id, execution.id);
  } });
  useEffect(() => () => controller?.abort(), [controller]);

  if (explorer.isLoading) return <LoadingBlock label="Dang tao Explorer cho profile nay..." />;
  if (explorer.isError) return <ErrorNotice error={explorer.error} retry={() => explorer.refetch()} />;
  if (!context) return <EmptyState title="Explorer chua co context" detail="Mo lai tab de tao semantic context tu profile da review." />;
  const disabled = profile.status !== "completed" || preview.isPending || promote.isPending || (aggregate !== "count" && !column);

  return <section className="command-explorer">
    <header><h2>Khám phá dữ liệu</h2><p className='muted'>Tạo truy vấn tổng hợp có giới hạn mà không cần SQL. Preview dùng mẫu giới hạn; chỉ kết quả Official mới được dùng làm evidence cho báo cáo.</p></header>
    {(dimensions.length === 0 && measures.length === 0) && <Notice tone='warning'>Không có cột an toàn trong context. Hãy review semantic type và PII trước khi chạy Explorer.</Notice>}
    <form className="panel command-query-form" onSubmit={(event) => { event.preventDefault(); preview.mutate(); }}>
      <label>Aggregate<select value={aggregate} onChange={(event) => setAggregate(event.target.value as QuerySpec["aggregate"])}>{AGGREGATES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
      <label>Measure<select value={column} disabled={aggregate === "count"} onChange={(event) => setColumn(event.target.value)}><option value="">{aggregate === "count" ? "Khong can cot" : "Chon measure"}</option>{measures.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <label>Group by<select value={dimension} onChange={(event) => setDimension(event.target.value)}><option value="">Khong chia nhom</option>{dimensions.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <label>Filter column<select value={filterColumn} onChange={(event) => setFilterColumn(event.target.value)}><option value="">Khong loc</option>{[...dimensions, ...measures].map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <label>Filter value<input value={filterValue} disabled={!filterColumn} onChange={(event) => setFilterValue(event.target.value)} /></label>
      <div className="command-query-actions"><p className="muted">{execution?.query_summary || `Preview: ${query.aggregate}${query.column ? ` ${query.column}` : ""}${query.dimensions.length ? ` theo ${query.dimensions.join(", ")}` : ""} · tối đa 50 nhóm`}</p><button className="button primary" disabled={disabled}>{preview.isPending ? "Đang preview…" : "Chạy preview"}</button>{controller && <button type="button" className="button secondary" onClick={() => controller.abort()}>Hủy request</button>}</div>
    </form>
    {preview.isError && <ErrorNotice error={preview.error} retry={() => preview.reset()} />}
    {promote.isError && <ErrorNotice error={promote.error} retry={() => promote.reset()} />}
    {pin.isError && <ErrorNotice error={pin.error} retry={() => pin.reset()} />}
    {execution && <><ResultTable execution={execution} />
      <div className='inline-actions command-result-actions'>
        <button className='button secondary' type='button' onClick={() => onExplain(execution)}>Giải thích</button>
        <button className='button secondary' type='button' onClick={() => preview.mutate()} disabled={preview.isPending}>Nhân bản preview</button>
        {execution.execution_kind === 'preview' && <button className='button primary' type='button' onClick={() => promote.mutate()} disabled={promote.isPending}>{promote.isPending ? 'Đang xác nhận…' : 'Xác nhận kết quả'}</button>}
        <button className='button secondary' type='button' onClick={() => pin.mutate()} disabled={execution.execution_kind === 'preview' || pin.isPending}>{pin.isPending ? 'Đang ghim…' : 'Pin vào báo cáo'}</button>
        {pin.isSuccess && <span className='chip'>Đã ghim vào Report Draft</span>}
      </div>
    </>}
  </section>;
}

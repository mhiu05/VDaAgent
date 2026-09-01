"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { detectDrift, listDatasets, listRuns } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import type { DriftFinding, DriftResponse, ProfileRunSummary } from "@/lib/types";
import { useAuth } from "@/components/auth-provider";
import { EmptyState, ErrorNotice, InfoTip, LoadingBlock, LoadingButton, Notice, PageHeader, useToast } from "@/components/ui";
import { driftDisplayValue, driftEvidenceLabel, driftSeverityLabel, driftTypeLabel, groupDriftFindingRecords } from "@/lib/drift-evidence";

type CompletedRun = ProfileRunSummary & { datasetName: string };
type Severity = DriftFinding["severity"];

function runLabel(run: CompletedRun) {
  return run.run_name?.trim() || `Phiên bản v${run.version ?? "—"}`;
}

function runMeta(run: CompletedRun) {
  const scan = run.scan_mode === "full" ? "Full scan" : run.scan_mode === "sample" ? "Sample scan" : null;
  const rows = run.row_count === null || run.row_count === undefined ? null : `${formatNumber(run.row_count)} dòng`;
  return [scan, rows, run.created_at ? formatDate(run.created_at) : null].filter(Boolean).join(" · ");
}

function RunSelector({ id, role, description, value, runs, excludeRunId, disabled, onChange }: {
  id: string; role: "Baseline" | "Current"; description: string; value: string; runs: CompletedRun[];
  excludeRunId: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const selected = runs.find((run) => run.id === value);
  return <section className="compare-run-card">
    <div className="compare-run-card-heading"><div><p className="eyebrow">{role}</p><h2>{role === "Baseline" ? "Mốc dữ liệu đối chiếu" : "Phiên cần kiểm tra"}</h2></div><span className="compare-run-state">Hoàn tất</span></div>
    <p>{description}</p>
    <label htmlFor={id}>Profile Run</label>
    <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">Chọn Profile Run đã hoàn tất…</option>
      {runs.filter((run) => run.id !== excludeRunId).map((run) => <option key={run.id} value={run.id}>{run.datasetName} — {runLabel(run)}</option>)}
    </select>
    {selected ? <div className="compare-run-metadata" aria-live="polite"><b>{selected.datasetName}</b><span>{runLabel(selected)}</span><small>{runMeta(selected) || "Metadata giới hạn theo Profile Run"}</small></div> : <div className="compare-run-metadata is-empty"><span>Chưa chọn Profile Run.</span><small>Chỉ các phiên đã hoàn tất mới xuất hiện.</small></div>}
  </section>;
}

function MethodologyTip() {
  return <InfoTip label="Phương pháp đánh giá data drift"><b>Evidence do backend tính.</b><br />PSI, thay đổi tỷ lệ thiếu, cardinality, chỉ số số và schema được tính từ profile aggregate đã lưu. Giao diện không đọc raw row hoặc tự phân loại drift.</InfoTip>;
}

function FindingDetail({ finding }: { finding: DriftFinding }) {
  return <article className="compare-evidence-item">
    <div><b>{driftTypeLabel(finding.drift_type)}</b><span className={`compare-severity compare-severity-${finding.severity}`}>{driftSeverityLabel(finding.severity)}</span></div>
    <p>{finding.detail}</p>
    <dl><div><dt>Evidence</dt><dd>{driftEvidenceLabel(finding)}</dd></div>
      {(finding.baseline_value !== undefined || finding.current_value !== undefined) && <><div><dt>Baseline</dt><dd>{driftDisplayValue(finding.baseline_value)}</dd></div><div><dt>Current</dt><dd>{driftDisplayValue(finding.current_value)}</dd></div></>}
    </dl>
  </article>;
}

export function CompareWorkspace() {
  const { workspaceId } = useAuth();
  const toast = useToast();
  const [baselineId, setBaselineId] = useState("");
  const [currentId, setCurrentId] = useState("");
  const [result, setResult] = useState<DriftResponse | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const previousWorkspaceId = useRef<string | null>(workspaceId);

  const datasets = useQuery({ queryKey: ["compare", workspaceId, "datasets"], queryFn: ({ signal }) => listDatasets(signal), enabled: Boolean(workspaceId) });
  const runQueries = useQueries({
    queries: (datasets.data ?? []).map((dataset) => ({
      queryKey: ["compare", workspaceId, "runs", dataset.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => listRuns(dataset.id, signal),
      enabled: Boolean(workspaceId),
    })),
  });
  const completedRuns = useMemo<CompletedRun[]>(() => (datasets.data ?? []).flatMap((dataset, index) =>
    (runQueries[index]?.data ?? []).filter((run) => run.status === "completed").map((run) => ({ ...run, datasetName: dataset.name })),
  ).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")), [datasets.data, runQueries]);
  const catalogLoading = datasets.isPending || runQueries.some((query) => query.isPending);
  const catalogError = datasets.error ?? runQueries.find((query) => query.error)?.error;

  useEffect(() => {
    if (previousWorkspaceId.current === workspaceId) return;
    previousWorkspaceId.current = workspaceId;
    setBaselineId(""); setCurrentId(""); setResult(null); setSelectedColumn(null); setSearch(""); setSeverity("all");
  }, [workspaceId]);
  useEffect(() => {
    const ids = new Set(completedRuns.map((run) => run.id));
    if ((baselineId && !ids.has(baselineId)) || (currentId && !ids.has(currentId))) {
      setBaselineId(""); setCurrentId(""); setResult(null); setSelectedColumn(null);
    }
  }, [baselineId, completedRuns, currentId]);

  const comparison = useMutation({
    mutationFn: () => detectDrift(currentId, baselineId),
    onSuccess: (nextResult) => {
      const firstColumn = groupDriftFindingRecords(nextResult.findings)[0]?.name ?? null;
      setResult(nextResult); setSelectedColumn(firstColumn); setSearch(""); setSeverity("all");
      toast.success(nextResult.findings.length ? "Đã hoàn tất so sánh và tổng hợp evidence." : "Đã hoàn tất: không phát hiện drift đáng chú ý.");
    },
  });
  const columns = useMemo(() => groupDriftFindingRecords(result?.findings ?? []), [result]);
  const visibleColumns = useMemo(() => columns.filter((column) => {
    const normalizedSearch = search.trim().toLocaleLowerCase("vi");
    return column.name.toLocaleLowerCase("vi").includes(normalizedSearch) && (severity === "all" || column.severity === severity);
  }), [columns, search, severity]);
  const majorCount = result?.findings.filter((finding) => finding.severity === "major").length ?? 0;
  const minorCount = result?.findings.filter((finding) => finding.severity === "minor").length ?? 0;
  const canCompare = Boolean(baselineId && currentId && baselineId !== currentId);
  const baselineRun = completedRuns.find((run) => run.id === result?.baseline_run_id);
  const currentRun = completedRuns.find((run) => run.id === result?.current_run_id);

  function selectBaseline(nextId: string) {
    setBaselineId(nextId); if (nextId === currentId) setCurrentId(""); setResult(null); setSelectedColumn(null);
  }
  function selectCurrent(nextId: string) {
    setCurrentId(nextId); if (nextId === baselineId) setBaselineId(""); setResult(null); setSelectedColumn(null);
  }

  return <div className="compare-workspace">
    <PageHeader eyebrow="DATA DRIFT" title="So sánh dữ liệu" description="Phát hiện thay đổi về phân phối, chất lượng và cấu trúc giữa hai Profile Run đã hoàn tất." action={<span className="compare-methodology"><span>Phương pháp đánh giá</span><MethodologyTip /></span>} />
    {catalogLoading && <LoadingBlock label="Đang tải các Profile Run trong workspace…" />}
    {catalogError && <ErrorNotice error={catalogError} retry={() => { void datasets.refetch(); void Promise.all(runQueries.map((query) => query.refetch())); }} />}
    {!catalogLoading && !catalogError && completedRuns.length < 2 && <EmptyState title={completedRuns.length === 0 ? "Chưa có Profile Run phù hợp" : "Cần thêm một Profile Run"} detail={completedRuns.length === 0 ? "Bạn cần ít nhất hai Profile Run đã hoàn tất để thực hiện so sánh drift." : "Workspace hiện chỉ có một Profile Run đã hoàn tất. Hãy hoàn tất thêm một phiên để bắt đầu so sánh."} action={<Link href="/datasets" className="button primary">Xem Profile Runs</Link>} />}
    {!catalogLoading && !catalogError && completedRuns.length >= 2 && <>
      <section className="panel compare-selector-panel" aria-labelledby="compare-selector-title">
        <div className="compare-selector-heading"><div><p className="eyebrow">CHỌN NGỮ CẢNH</p><h2 id="compare-selector-title">Chọn Profile Run để so sánh</h2><p>Baseline là mốc đối chiếu; Current là phiên cần kiểm tra thay đổi.</p></div><span className={canCompare ? "compare-ready" : "compare-not-ready"}>{canCompare ? "Sẵn sàng gửi yêu cầu" : "Chọn đủ hai Profile Run"}</span></div>
        <div className="compare-run-grid"><RunSelector id="compare-baseline" role="Baseline" description="Mốc dữ liệu dùng để đối chiếu." value={baselineId} runs={completedRuns} excludeRunId={currentId} disabled={comparison.isPending} onChange={selectBaseline} /><span className="compare-direction" aria-hidden="true">→</span><RunSelector id="compare-current" role="Current" description="Phiên cần kiểm tra thay đổi." value={currentId} runs={completedRuns} excludeRunId={baselineId} disabled={comparison.isPending} onChange={selectCurrent} /></div>
        <div className="compare-selector-footer"><p>{canCompare ? "Backend sẽ kiểm tra quyền truy cập và tính evidence từ column statistics đã lưu." : "Chọn Baseline và Current khác nhau để tiếp tục."}</p><LoadingButton type="button" className="button primary" busy={comparison.isPending} disabled={!canCompare} onClick={() => comparison.mutate()}>{comparison.isPending ? "Đang phân tích drift…" : "So sánh dữ liệu"}</LoadingButton></div>
        {comparison.isError && <ErrorNotice error={comparison.error} retry={() => comparison.mutate()} />}
      </section>
      {!result && !comparison.isPending && <section className="compare-awaiting-result" aria-live="polite"><span aria-hidden="true">↔</span><div><b>Kết quả so sánh sẽ xuất hiện tại đây</b><p>Chỉ số và severity đều do deterministic backend tính từ Profile Run đã chọn.</p></div></section>}
      {comparison.isPending && <section className="compare-progress" aria-live="polite"><span className="spinner" aria-hidden="true" /><div><b>Đang so sánh Profile Run</b><p>Đang lấy evidence aggregate từ backend. Không sử dụng raw rows.</p></div></section>}
    </>}
    {result && <section className="compare-results" aria-labelledby="compare-results-title">
      <header className="compare-results-heading"><div><p className="eyebrow">KẾT QUẢ EVIDENCE</p><h2 id="compare-results-title">Tổng quan drift</h2><p>{result.summary}</p></div><div className="compare-result-context"><span>Baseline → Current</span><b>{baselineRun ? runLabel(baselineRun) : "Profile Run đã chọn"}</b><small>→ {currentRun ? runLabel(currentRun) : "Profile Run đã chọn"}</small></div></header>
      {result.findings.length === 0 ? <Notice tone="success"><b>Không phát hiện drift đáng chú ý.</b><p>Kết quả deterministic từ backend không ghi nhận signal drift cho cặp Profile Run này.</p></Notice> : <>
        <div className="compare-summary-grid"><article><span>Nghiêm trọng</span><b>{formatNumber(majorCount)}</b><small>Signal major</small></article><article><span>Cần theo dõi</span><b>{formatNumber(minorCount)}</b><small>Signal minor</small></article><article><span>Cột có evidence</span><b>{formatNumber(columns.length)}</b><small>{formatNumber(result.findings.length)} signal backend trả về</small></article></div>
        <section className="panel compare-table-panel" aria-labelledby="compare-column-title"><div className="compare-table-heading"><div><h2 id="compare-column-title">Chi tiết theo cột</h2><p>Ưu tiên các cột có signal nghiêm trọng. Toàn bộ evidence được hiển thị bên dưới.</p></div><span>{formatNumber(visibleColumns.length)} / {formatNumber(columns.length)} cột</span></div><div className="compare-table-controls"><label><span>Tìm cột</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tên cột…" /></label><label><span>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value as "all" | Severity)}><option value="all">Tất cả severity</option><option value="major">Nghiêm trọng</option><option value="minor">Cần theo dõi</option></select></label></div>
          {visibleColumns.length ? <div className="table-wrap"><table className="compare-table"><thead><tr><th>Cột</th><th>Severity</th><th>Evidence</th><th>Signal</th></tr></thead><tbody>{visibleColumns.map((column) => <tr key={column.name} className={selectedColumn === column.name ? "is-selected" : ""}><td><button type="button" className="compare-column-trigger" onClick={() => setSelectedColumn(column.name)} aria-pressed={selectedColumn === column.name} aria-controls={`compare-detail-${encodeURIComponent(column.name)}`}>{column.name}<small>Đánh dấu evidence →</small></button></td><td><span className={`compare-severity compare-severity-${column.severity}`}>{driftSeverityLabel(column.severity)}</span></td><td>{driftEvidenceLabel(column.findings[0])}</td><td>{formatNumber(column.findings.length)} signal</td></tr>)}</tbody></table></div> : <div className="compare-no-results"><b>Không có cột phù hợp với bộ lọc.</b><button type="button" className="button secondary" onClick={() => { setSearch(""); setSeverity("all"); }}>Xóa bộ lọc</button></div>}
        </section>
        <div className="compare-detail-list">{visibleColumns.map((column) => <section className="panel compare-detail-panel" id={`compare-detail-${encodeURIComponent(column.name)}`} aria-labelledby={`compare-detail-title-${encodeURIComponent(column.name)}`} key={column.name}><div className="compare-detail-heading"><div><p className="eyebrow">EVIDENCE CỘT</p><h2 id={`compare-detail-title-${encodeURIComponent(column.name)}`}>{column.name}</h2><p>{column.findings.length} signal được backend trả về cho cột này.</p></div><span className={`compare-severity compare-severity-${column.severity}`}>{driftSeverityLabel(column.severity)}</span></div><div className="compare-evidence-list">{column.findings.map((finding, index) => <FindingDetail key={`${finding.drift_type}-${index}`} finding={finding as DriftFinding} />)}</div></section>)}</div><p className="compare-evidence-note">Phân phối chi tiết theo bins/categories chưa có trong contract drift hiện tại; trang chỉ hiển thị aggregate evidence mà backend trả về.</p><Link href={baselineId ? `/profiles/${encodeURIComponent(baselineId)}/preview` : "/datasets"} className="button secondary">Xem preview Profile Run baseline</Link>
      </>}
    </section>}
  </div>;
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { detectDrift, downloadExport, getProfile, listRuns, runTests } from "@/lib/api";
import { formatNumber, toTitle } from "@/lib/format";
import { ErrorNotice, LoadingBlock, Notice, PageHeader } from "@/components/ui";
import type { DriftResponse, TestResponse } from "@/lib/types";

const tests = [
  { value: "shapiro_wilk", label: "Shapiro–Wilk (normality)", columns: 1 },
  { value: "pearson", label: "Pearson correlation", columns: 2 },
  { value: "spearman", label: "Spearman correlation", columns: 2 },
  { value: "ttest_ind", label: "Independent t-test", columns: 2 },
];

function DriftPanel({ report }: { report: DriftResponse | null }) {
  if (!report) return <p className="muted">Chọn baseline run để kiểm tra drift tương thích.</p>;
  return <><Notice tone={report.findings.some((finding) => finding.severity === "major") ? "warning" : "info"}><b>{report.summary}</b><p>Baseline: {report.baseline_run_id}</p></Notice>{report.findings.length > 0 && <div className="table-wrap"><table><thead><tr><th>Cột</th><th>Loại</th><th>Severity</th><th>Metric</th><th>Chi tiết</th></tr></thead><tbody>{report.findings.map((finding, index) => <tr key={`${finding.column_name}-${index}`}><td>{finding.column_name || "Dataset"}</td><td>{toTitle(finding.drift_type)}</td><td><span className={`status status-${finding.severity === "major" ? "failed" : "pending_review"}`}>{finding.severity}</span></td><td>{finding.metric || "—"}{finding.psi !== null && finding.psi !== undefined && ` · PSI ${formatNumber(finding.psi, 3)}`}</td><td>{finding.detail}</td></tr>)}</tbody></table></div>}</>;
}

export default function AnalysisPage() {
  const { runId } = useParams<{ runId: string }>();
  const [testType, setTestType] = useState("shapiro_wilk");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [alpha, setAlpha] = useState(.05);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [baseline, setBaseline] = useState("");
  const [driftResult, setDriftResult] = useState<DriftResponse | null>(null);
  const profile = useQuery({ queryKey: ["profile", runId], queryFn: ({ signal }) => getProfile(runId, signal), enabled: Boolean(runId) });
  const runs = useQuery({ queryKey: ["runs", profile.data?.dataset_id], queryFn: ({ signal }) => listRuns(profile.data!.dataset_id, signal), enabled: Boolean(profile.data?.dataset_id) });
  const requiredColumns = tests.find((item) => item.value === testType)?.columns ?? 1;
  const availableColumns = useMemo(() => Object.keys(profile.data?.column_stats || {}), [profile.data]);
  const testMutation = useMutation({ mutationFn: () => runTests(runId, { requested_by: "analyst@local", tests: [{ test_type: testType, columns: selectedColumns }], alpha }), onSuccess: setTestResult });
  const driftMutation = useMutation({ mutationFn: () => detectDrift(runId, baseline), onSuccess: setDriftResult });
  const exportMutation = useMutation({ mutationFn: () => downloadExport(runId), onSuccess: (blob) => { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `profile-${runId}.json`; anchor.click(); URL.revokeObjectURL(url); } });
  function toggleColumn(column: string) { setSelectedColumns((current) => current.includes(column) ? current.filter((value) => value !== column) : current.length < requiredColumns ? [...current, column] : [current[1], column].filter(Boolean)); }
  if (profile.isLoading) return <LoadingBlock label="Đang tải công cụ phân tích…" />;
  if (profile.isError || !profile.data) return <ErrorNotice error={profile.error || new Error("Không tìm thấy profile.")} retry={() => profile.refetch()} />;
  return <>
    <PageHeader eyebrow={`Analysis · ${runId}`} title="Deep analysis" description="Kiểm định và drift dùng tool allow-list của backend; giao diện không tự suy luận kết quả." action={<Link href={`/profiles/${runId}`} className="button secondary">Về report</Link>} />
    <div className="grid two"><section className="panel"><div className="panel-title"><h2>Kiểm định thống kê</h2><small>Multiple-testing correction ở backend</small></div>{testMutation.isError && <ErrorNotice error={testMutation.error} />}<div className="form-grid"><div className="field"><label htmlFor="test-type">Test</label><select id="test-type" value={testType} onChange={(event) => { setTestType(event.target.value); setSelectedColumns([]); }}>{tests.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></div><div className="field"><label htmlFor="alpha">Alpha</label><input id="alpha" type="number" min="0.001" max="0.99" step="0.01" value={alpha} onChange={(event) => setAlpha(Number(event.target.value))} /></div><div className="field full"><label>Chọn {requiredColumns} cột</label><div className="chip-list">{availableColumns.map((column) => <label className="chip" key={column}><input type="checkbox" checked={selectedColumns.includes(column)} onChange={() => toggleColumn(column)} /> {column}</label>)}</div></div></div><div className="form-actions"><button className="button primary" disabled={selectedColumns.length !== requiredColumns || testMutation.isPending} onClick={() => testMutation.mutate()}>{testMutation.isPending ? "Đang chạy test…" : "Chạy kiểm định"}</button></div>{testResult && <div className="table-wrap" style={{ marginTop: 16 }}><table><thead><tr><th>Test</th><th>Statistic</th><th>p (adjusted)</th><th>Kết luận</th></tr></thead><tbody>{testResult.results.map((result, index) => <tr key={index}><td>{result.test_type}</td><td>{formatNumber(result.test_statistic, 4)}</td><td>{formatNumber(result.p_value_adjusted ?? result.p_value, 5)}</td><td>{result.conclusion}<br /><small>{result.interpretation}</small></td></tr>)}</tbody></table></div>}</section>
      <section className="panel"><div className="panel-title"><h2>So sánh drift</h2><small>Chỉ run cùng dataset</small></div>{driftMutation.isError && <ErrorNotice error={driftMutation.error} />}<div className="field"><label htmlFor="baseline">Baseline profile run</label><select id="baseline" value={baseline} onChange={(event) => setBaseline(event.target.value)}><option value="">Chọn baseline…</option>{runs.data?.filter((run) => run.id !== runId).map((run) => <option key={run.id} value={run.id}>v{run.version ?? "—"} · {run.status} · {run.id.slice(0, 8)}</option>)}</select></div><div className="form-actions"><button className="button primary" disabled={!baseline || driftMutation.isPending} onClick={() => driftMutation.mutate()}>{driftMutation.isPending ? "Đang so sánh…" : "Kiểm tra drift"}</button></div><div style={{ marginTop: 16 }}><DriftPanel report={driftResult} /></div></section></div>
    <section className="panel" style={{ marginTop: 18 }}><div className="panel-title"><h2>Export metadata</h2><span className="chip pii">PII-safe</span></div><p className="muted">Export chỉ gồm metadata, thống kê, evidence và provenance. Raw dataset và top-k bị policy cấm sẽ không được đưa vào file.</p>{exportMutation.isError && <ErrorNotice error={exportMutation.error} />}<button className="button secondary" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate()}>{exportMutation.isPending ? "Đang chuẩn bị…" : "Tải JSON export"}</button></section>
  </>;
}

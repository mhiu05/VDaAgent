"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ALL_COMBINED_REPORT_SECTIONS,
  downloadCombinedJson,
  downloadCombinedReport,
  detectDrift,
  getProfile,
  listAnalyses,
  listRuns,
  runTests,
  type CombinedReportSection,
} from "@/lib/api";
import { formatNumber, toTitle } from "@/lib/format";
import { ErrorNotice, LoadingBlock, Notice, PageHeader } from "@/components/ui";
import type { DriftResponse, TestResponse } from "@/lib/types";

const tests = [
  { value: "shapiro_wilk", label: "Shapiro–Wilk (phân phối chuẩn)", columns: 1 },
  { value: "pearson", label: "Tương quan Pearson", columns: 2 },
  { value: "spearman", label: "Tương quan Spearman", columns: 2 },
  { value: "ttest_ind", label: "t-test độc lập", columns: 2 },
];

const exportSectionOptions: Array<{ key: CombinedReportSection; number: string; label: string; description: string }> = [
  { key: "overview", number: "1", label: "Tổng quan dataset", description: "Tên dataset, profile run, trạng thái và quy mô dữ liệu." },
  { key: "technical_profile", number: "2", label: "Hồ sơ kỹ thuật", description: "Kiểu dữ liệu, null, cardinality, unique và biểu đồ profile." },
  { key: "quality", number: "3", label: "Chất lượng & quyền riêng tư", description: "Risk warning, giới hạn export và chính sách PII." },
  { key: "tests", number: "4", label: "Kiểm định thống kê", description: "Các kiểm định đã chạy, p-value và kết luận." },
  { key: "drift", number: "5", label: "Báo cáo drift", description: "So sánh profile hiện tại với baseline." },
  { key: "agent_summary", number: "6", label: "Tóm tắt từ Agent", description: "Phần diễn giải metric đã được kiểm chứng." },
  { key: "analysis", number: "7", label: "Phân tích nghiệp vụ", description: "Context, quality gate, execution và aggregate evidence." },
];

function DriftPanel({ report }: { report: DriftResponse | null }) {
  if (!report) return <p className="muted">Chọn baseline run để kiểm tra drift tương thích.</p>;
  return <>
    <Notice tone={report.findings.some((finding) => finding.severity === "major") ? "warning" : "info"}><b>{report.summary}</b><p>Baseline: {report.baseline_run_id}</p></Notice>
    {report.findings.length > 0 && <div className="table-wrap"><table><thead><tr><th>Cột</th><th>Loại</th><th>Severity</th><th>Metric</th><th>Chi tiết</th></tr></thead><tbody>{report.findings.map((finding, index) => <tr key={`${finding.column_name}-${index}`}><td>{finding.column_name || "Dataset"}</td><td>{toTitle(finding.drift_type)}</td><td><span className={`status status-${finding.severity === "major" ? "failed" : "pending_review"}`}>{finding.severity}</span></td><td>{finding.metric || "—"}{finding.psi !== null && finding.psi !== undefined && ` · PSI ${formatNumber(finding.psi, 3)}`}</td><td>{finding.detail}</td></tr>)}</tbody></table></div>}
  </>;
}

export default function AnalysisPage() {
  const { runId } = useParams<{ runId: string }>();
  const [testType, setTestType] = useState("shapiro_wilk");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [alpha, setAlpha] = useState(.05);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [baseline, setBaseline] = useState("");
  const [driftResult, setDriftResult] = useState<DriftResponse | null>(null);
  const [exportFormat, setExportFormat] = useState<"pdf" | "json">("pdf");
  const [selectedExportSections, setSelectedExportSections] = useState<CombinedReportSection[]>(ALL_COMBINED_REPORT_SECTIONS);
  const profile = useQuery({ queryKey: ["profile", runId], queryFn: ({ signal }) => getProfile(runId, signal), enabled: Boolean(runId) });
  const analyses = useQuery({ queryKey: ["analyses", "profile", runId], queryFn: ({ signal }) => listAnalyses(signal, runId), enabled: Boolean(runId) });
  const runs = useQuery({ queryKey: ["runs", profile.data?.dataset_id], queryFn: ({ signal }) => listRuns(profile.data!.dataset_id, signal), enabled: Boolean(profile.data?.dataset_id) });
  const requiredColumns = tests.find((item) => item.value === testType)?.columns ?? 1;
  const availableColumns = useMemo(() => Object.keys(profile.data?.column_stats || {}), [profile.data]);
  const testMutation = useMutation({ mutationFn: () => runTests(runId, { tests: [{ test_type: testType, columns: selectedColumns }], alpha }), onSuccess: setTestResult });
  const driftMutation = useMutation({ mutationFn: () => detectDrift(runId, baseline), onSuccess: setDriftResult });
  const exportMutation = useMutation({
    mutationFn: () => exportFormat === "pdf" ? downloadCombinedReport(runId, selectedExportSections) : downloadCombinedJson(runId, selectedExportSections),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `profile-${runId}.${exportFormat}`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
  });

  function toggleColumn(column: string) {
    setSelectedColumns((current) => current.includes(column) ? current.filter((value) => value !== column) : current.length < requiredColumns ? [...current, column] : [current[1], column].filter(Boolean));
  }

  function toggleExportSection(section: CombinedReportSection) {
    setSelectedExportSections((current) => current.includes(section) ? current.filter((item) => item !== section) : [...current, section]);
  }

  if (profile.isLoading) return <LoadingBlock label="Đang tải công cụ phân tích…" />;
  if (profile.isError || !profile.data) return <ErrorNotice error={profile.error || new Error("Không tìm thấy profile.")} retry={() => profile.refetch()} />;

  const allSelected = selectedExportSections.length === ALL_COMBINED_REPORT_SECTIONS.length;
  return <>
    <PageHeader eyebrow={`Phân tích · ${runId}`} title="Phân tích chuyên sâu" description="Kiểm định và drift dùng tool allow-list của backend; giao diện không tự suy luận kết quả." action={<Link href={`/profiles/${runId}`} className="button secondary">Về báo cáo</Link>} />
    <div className="grid two">
      <section className="panel"><div className="panel-title"><h2>Kiểm định thống kê</h2><small>Multiple-testing correction ở backend</small></div>{testMutation.isError && <ErrorNotice error={testMutation.error} />}<div className="form-grid"><div className="field"><label htmlFor="test-type">Test</label><select id="test-type" value={testType} onChange={(event) => { setTestType(event.target.value); setSelectedColumns([]); }}>{tests.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></div><div className="field"><label htmlFor="alpha">Alpha</label><input id="alpha" type="number" min="0.001" max="0.99" step="0.01" value={alpha} onChange={(event) => setAlpha(Number(event.target.value))} /></div><div className="field full"><label>Chọn {requiredColumns} cột</label><div className="chip-list">{availableColumns.map((column) => <label className="chip" key={column}><input type="checkbox" checked={selectedColumns.includes(column)} onChange={() => toggleColumn(column)} /> {column}</label>)}</div></div></div><div className="form-actions"><button className="button primary" disabled={selectedColumns.length !== requiredColumns || testMutation.isPending} onClick={() => testMutation.mutate()}>{testMutation.isPending ? "Đang chạy test…" : "Chạy kiểm định"}</button></div>{testResult && <div className="table-wrap" style={{ marginTop: 16 }}><table><thead><tr><th>Test</th><th>Statistic</th><th>p (adjusted)</th><th>Kết luận</th></tr></thead><tbody>{testResult.results.map((result, index) => <tr key={index}><td>{result.test_type}</td><td>{formatNumber(result.test_statistic, 4)}</td><td>{formatNumber(result.p_value_adjusted ?? result.p_value, 5)}</td><td>{result.conclusion}<br /><small>{result.interpretation}</small></td></tr>)}</tbody></table></div>}</section>
      <section className="panel"><div className="panel-title"><h2>So sánh drift</h2><small>Chỉ run cùng dataset</small></div>{driftMutation.isError && <ErrorNotice error={driftMutation.error} />}<div className="field"><label htmlFor="baseline">Baseline profile run</label><select id="baseline" value={baseline} onChange={(event) => setBaseline(event.target.value)}><option value="">Chọn baseline…</option>{runs.data?.filter((run) => run.id !== runId).map((run) => <option key={run.id} value={run.id}>v{run.version ?? "—"} · {run.status} · {run.id.slice(0, 8)}</option>)}</select></div><div className="form-actions"><button className="button primary" disabled={!baseline || driftMutation.isPending} onClick={() => driftMutation.mutate()}>{driftMutation.isPending ? "Đang so sánh…" : "Kiểm tra drift"}</button></div><div style={{ marginTop: 16 }}><DriftPanel report={driftResult} /></div></section>
    </div>

    <section className="panel export-panel" style={{ marginTop: 18 }}>
      <div className="panel-title"><div><p className="eyebrow">BƯỚC CUỐI</p><h2>Xuất báo cáo</h2><small>Chọn đúng nội dung người đọc cần xem</small></div><span className="chip pii">An toàn với PII</span></div>
      {analyses.data?.length ? <Notice tone="success"><b>{analyses.data.length} phiên phân tích đã được liên kết.</b><p>Bạn có thể đưa context, quality gate và aggregate evidence vào báo cáo bằng mục 7.</p></Notice> : <Notice tone="info"><b>Chưa có phiên phân tích.</b><p>Bạn có thể <Link href={`/analyses/new?runId=${encodeURIComponent(runId)}`}>thêm một phiên phân tích</Link>, hoặc xuất báo cáo kỹ thuật hiện tại.</p></Notice>}
      <p className="muted">Các mục được đánh số theo cấu trúc 1 → 1.1 → 1.1.1 trong PDF. JSON cũng ghi rõ danh sách mục đã chọn.</p>
      <div className="export-selection-toolbar"><div><b>Nội dung xuất</b><small>{selectedExportSections.length}/{ALL_COMBINED_REPORT_SECTIONS.length} mục được chọn</small></div><div className="inline-actions"><button type="button" className="button secondary" onClick={() => setSelectedExportSections(ALL_COMBINED_REPORT_SECTIONS)} disabled={allSelected}>Chọn tất cả</button><button type="button" className="button ghost" onClick={() => setSelectedExportSections([])} disabled={selectedExportSections.length === 0}>Bỏ chọn tất cả</button></div></div>
      <div className="export-checklist">{exportSectionOptions.map((section) => <label className={`export-check-item${selectedExportSections.includes(section.key) ? " selected" : ""}`} key={section.key}><input type="checkbox" checked={selectedExportSections.includes(section.key)} onChange={() => toggleExportSection(section.key)} /><span className="export-check-number">{section.number}</span><span><b>{section.label}</b><small>{section.description}</small></span></label>)}</div>
      <div className="export-format-row"><div><b>Định dạng</b><small>PDF để đọc/chia sẻ · JSON cho tích hợp và kiểm thử</small></div><div className="inline-actions"><label className="chip"><input type="radio" name="export-format" checked={exportFormat === "pdf"} onChange={() => setExportFormat("pdf")} /> Báo cáo PDF</label><label className="chip"><input type="radio" name="export-format" checked={exportFormat === "json"} onChange={() => setExportFormat("json")} /> Báo cáo JSON</label></div></div>
      {exportMutation.isError && <ErrorNotice error={exportMutation.error} />}<div className="form-actions"><button className="button primary" disabled={exportMutation.isPending || selectedExportSections.length === 0} onClick={() => exportMutation.mutate()}>{exportMutation.isPending ? "Đang chuẩn bị…" : `Xuất ${exportFormat.toUpperCase()} · ${selectedExportSections.length} mục`}</button></div>
    </section>
  </>;
}

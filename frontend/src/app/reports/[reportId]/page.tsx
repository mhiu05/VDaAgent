"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { downloadCombinedReport, getPublishedReport, ALL_COMBINED_REPORT_SECTIONS } from "@/lib/api";
import { ErrorNotice } from "@/components/ui";
import { MarkdownContent } from "@/components/markdown";

type Visualization = { id: string; chart_type: string; title: string | null; result_snapshot: { rows?: Array<Record<string, unknown>>; value?: unknown } };
type ReportSection = { id: string; kind: string; title?: string; content_json: { text?: string } };
type Report = { title: string; status?: string; versions: Array<{ status?: string; executive_summary?: string; scope?: { profile_run_id?: string }; sections: ReportSection[]; visualizations: Visualization[]; published_at?: string }> };

const statusLabels: Record<string, string> = { draft: "Bản nháp", in_review: "Đã xuất bản", published: "Đã xuất bản", archived: "Đã lưu trữ" };

export default function ReportPage() {
  const params = useParams<{ reportId: string }>();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const report = useQuery({ queryKey: ["published-report", params.reportId], queryFn: () => getPublishedReport<Report>(params.reportId) });

  async function exportFullPdf(profileRunId: string) {
    setExporting(true); setExportError(null);
    try {
      // Export is available immediately after the profile is completed; it
      // does not depend on a separate report approval workflow.
      const blob = await downloadCombinedReport(profileRunId, ALL_COMBINED_REPORT_SECTIONS, params.reportId);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `profile-report-${params.reportId}.pdf`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (error) { setExportError(error); } finally { setExporting(false); }
  }

  if (report.isPending) return <main className="page"><p>Đang tải report…</p></main>;
  if (report.isError || !report.data) return <main className="page"><p role="alert">{report.error?.message ?? "Không tìm thấy report."}</p></main>;
  const version = report.data.versions[0]; const profileRunId = version?.scope?.profile_run_id;
  return <main className="page report-detail-page">
    <div className="report-detail-toolbar">
      <Link className="button secondary" href="/reports">← Danh sách báo cáo</Link>
      {report.data.status && <span className="chip">{statusLabels[report.data.status] || report.data.status}</span>}
      {profileRunId && <button type="button" className="button primary" onClick={() => void exportFullPdf(profileRunId)} disabled={exporting}>{exporting ? "Đang tạo PDF…" : "Xuất PDF đầy đủ"}</button>}
    </div>
    {exportError !== null && <ErrorNotice error={exportError} />}
    <h1 className="report-detail-title">{report.data.title}</h1>
    {version?.executive_summary && <section className="panel report-detail-section"><h2>Tóm tắt điều hành</h2><MarkdownContent text={version.executive_summary} className="report report-markdown" /></section>}
    {version?.sections.map((section) => <section className="panel report-detail-section" key={section.id}><h2>{section.title || section.kind}</h2><MarkdownContent text={section.content_json.text || "—"} className="report report-markdown" /></section>)}
    {version?.visualizations.map((visualization) => <section className="panel report-detail-section" key={visualization.id}><h2>{visualization.title || visualization.chart_type}</h2><pre>{JSON.stringify(visualization.result_snapshot, null, 2)}</pre></section>)}
  </main>;
}

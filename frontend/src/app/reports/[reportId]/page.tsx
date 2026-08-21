"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { downloadCombinedReport, getPublishedReport, ALL_COMBINED_REPORT_SECTIONS } from "@/lib/api";
import type { AnalysisExecution, ChartSpec, QuerySpec } from "@/lib/analysis-types";
import { ErrorNotice } from "@/components/ui";
import { MarkdownContent } from "@/components/markdown";
import { ChartEvidenceView } from "@/components/command-center/chart-evidence-view";

type Visualization = { id: string; chart_type: string; title: string | null; result_snapshot: { rows?: Array<Record<string, unknown>>; value?: unknown } };
type ReportSection = { id: string; kind: string; title?: string; content_json: { text?: string } };
type ReportItem = {
  id: string;
  item_type: string;
  title: string | null;
  note?: string | null;
  query_spec?: QuerySpec | null;
  result_hash?: string | null;
  content_json?: {
    result?: AnalysisExecution["result"];
    chart_spec?: ChartSpec;
    insight?: string;
    answer?: string;
    text?: string;
  };
};
type Report = {
  id: string;
  title: string;
  status?: string;
  versions: Array<{
    status?: string;
    executive_summary?: string;
    scope?: { profile_run_id?: string };
    sections: ReportSection[];
    visualizations: Visualization[];
    items?: ReportItem[];
    published_at?: string;
  }>;
};

const statusLabels: Record<string, string> = { draft: "Bản nháp", in_review: "Đã xuất bản", published: "Đã xuất bản", archived: "Đã lưu trữ" };

export default function ReportPage() {
  const params = useParams<{ reportId: string }>();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const report = useQuery({ queryKey: ["published-report", params.reportId], queryFn: () => getPublishedReport<Report>(params.reportId) });

  async function exportFullPdf(profileRunId: string) {
    setExporting(true); setExportError(null);
    try {
      const blob = await downloadCombinedReport(profileRunId, ALL_COMBINED_REPORT_SECTIONS, params.reportId);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `profile-report-${params.reportId}.pdf`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (error) { setExportError(error); } finally { setExporting(false); }
  }

  if (report.isPending) return <main className="page"><p>Đang tải report…</p></main>;
  if (report.isError || !report.data) return <main className="page"><p role="alert">{report.error?.message ?? "Không tìm thấy report."}</p></main>;
  const version = report.data.versions[0]; const profileRunId = version?.scope?.profile_run_id;
  const items = version?.items ?? [];
  const tocItems: Array<{ id: string; title: string }> = [];
  if (version?.executive_summary) tocItems.push({ id: "executive_summary", title: "Tóm tắt điều hành" });
  items.forEach((item, idx) => {
    tocItems.push({ id: `item-${item.id}`, title: item.title || (item.item_type === "chart" ? `Biểu đồ ${idx + 1}` : `Giải thích ${idx + 1}`) });
  });
  version?.sections.forEach((section) => tocItems.push({ id: `section-${section.id}`, title: section.title || section.kind }));
  version?.visualizations.forEach((viz) => tocItems.push({ id: `viz-${viz.id}`, title: viz.title || viz.chart_type }));

  return (
    <>
      <main className="page report-detail-page">
        <div className="report-detail-toolbar">
          <Link className="button secondary" href="/reports">← Danh sách báo cáo</Link>
          {report.data.status && <span className="chip success">{statusLabels[report.data.status] || report.data.status}</span>}
          {profileRunId && <button type="button" className="button primary" onClick={() => void exportFullPdf(profileRunId)} disabled={exporting}>{exporting ? "Đang tạo PDF…" : "Xuất PDF đầy đủ"}</button>}
        </div>
        {exportError !== null && <ErrorNotice error={exportError} />}
        <h1 className="report-detail-title">{report.data.title}</h1>
        {version?.executive_summary && <section id="executive_summary" className="panel report-detail-section"><h2>Tóm tắt điều hành</h2><MarkdownContent text={version.executive_summary} className="report report-markdown" /></section>}
        
        {items.length > 0 && (
          <section className="report-items-container" style={{ display: "flex", flexDirection: "column", gap: "1.5rem", marginTop: "1rem" }}>
            {items.map((item) => (
              <article id={`item-${item.id}`} className="panel report-detail-section" key={item.id} style={{ padding: "1.5rem" }}>
                <header style={{ marginBottom: "1rem", borderBottom: "1px solid var(--color-border, #e5e7eb)", paddingBottom: "0.75rem" }}>
                  <span className="eyebrow" style={{ textTransform: "uppercase", fontSize: "0.75rem", color: "var(--color-primary, #2563eb)", fontWeight: 700 }}>{item.item_type === "chart" ? "Bằng chứng Biểu đồ" : "Giải thích Phân tích"}</span>
                  <h2 style={{ fontSize: "1.25rem", margin: "0.25rem 0" }}>{item.title || (item.item_type === "chart" ? "Biểu đồ Phân tích" : "Kết luận từ Agent")}</h2>
                  {item.query_spec && <p className="muted" style={{ fontSize: "0.85rem", color: "#6b7280" }}>{item.query_spec.aggregate} · {item.query_spec.analysis_kind} · hash {item.result_hash?.slice(0, 12)}</p>}
                </header>

                {item.item_type === "chart" && item.content_json?.result && item.content_json.chart_spec && item.query_spec && (
                  <div className="report-chart-box" style={{ margin: "1rem 0" }}>
                    <ChartEvidenceView chartSpec={item.content_json.chart_spec} result={item.content_json.result} querySpec={item.query_spec} title={item.title || undefined} />
                  </div>
                )}

                {item.content_json?.insight && (
                  <div className="report-insight-box" style={{ background: "rgba(99, 102, 241, 0.05)", borderLeft: "4px solid #6366f1", padding: "1rem 1.25rem", borderRadius: "0 8px 8px 0", marginTop: "1rem" }}>
                    <span className="eyebrow" style={{ fontSize: "0.75rem", fontWeight: 700, color: "#4f46e5", display: "block", marginBottom: "0.5rem" }}>💡 INSIGHT & KẾT LUẬN CHI TIẾT</span>
                    <MarkdownContent text={item.content_json.insight} className="report report-markdown" />
                  </div>
                )}

                {item.content_json?.answer && (
                  <div className="report-answer-box" style={{ padding: "1rem", background: "#f9fafb", borderRadius: "8px", marginTop: "1rem" }}>
                    <MarkdownContent text={item.content_json.answer} className="report report-markdown" />
                  </div>
                )}

                {item.note && (
                  <div className="report-note-box" style={{ marginTop: "1rem", fontStyle: "italic", color: "#4b5563" }}>
                    <b>Ghi chú:</b> {item.note}
                  </div>
                )}
              </article>
            ))}
          </section>
        )}

        {version?.sections.map((section) => <section id={`section-${section.id}`} className="panel report-detail-section" key={section.id}><h2>{section.title || section.kind}</h2><MarkdownContent text={section.content_json.text || "—"} className="report report-markdown" /></section>)}
        {version?.visualizations.map((visualization) => <section id={`viz-${visualization.id}`} className="panel report-detail-section" key={visualization.id}><h2>{visualization.title || visualization.chart_type}</h2><pre>{JSON.stringify(visualization.result_snapshot, null, 2)}</pre></section>)}
      </main>
      
      {tocItems.length > 0 && (
        <aside className="report-toc-sidebar">
          <div className="report-toc-container">
            <h3 className="report-toc-title">Nội dung</h3>
            <ul className="report-toc-list">
              {tocItems.map(item => (
                <li key={item.id}>
                  <a href={`#${item.id}`} onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" });
                  }}>
                    <span>{item.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </>
  );
}

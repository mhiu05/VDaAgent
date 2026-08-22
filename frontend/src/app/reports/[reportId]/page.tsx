"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { downloadCombinedReport, getReportExportSource, ALL_COMBINED_REPORT_SECTIONS } from "@/lib/api";
import type { AnalysisExecution, ChartSpec, QuerySpec } from "@/lib/analysis-types";
import { ErrorNotice } from "@/components/ui";
import { MarkdownContent } from "@/components/markdown";
import { ChartEvidenceView } from "@/components/command-center/chart-evidence-view";

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
  limitations?: string[] | null;
};

type ColumnStat = {
  column_name: string;
  inferred_type?: string;
  null_percentage?: number;
  distinct_count?: number;
  min_value?: unknown;
  max_value?: unknown;
  mean?: unknown;
};

type ExportSourcePayload = {
  profile: {
    dataset?: { name?: string };
    run: {
      id: string;
      version?: number;
      created_at?: string;
      scan_mode?: string;
      row_count?: number;
      status?: string;
      is_approximate?: boolean;
      narrative_report?: string | null;
      risk_warnings?: string[];
    };
    column_stats: ColumnStat[];
    proposals?: Record<string, Array<Record<string, unknown>>>;
  };
  report_snapshot?: {
    id: string;
    title?: string;
    snapshot_hash?: string;
    version?: number;
    snapshot_at?: string;
    items: ReportItem[];
  } | null;
};

export default function ReportPage() {
  const params = useParams<{ reportId: string }>();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);

  const reportQuery = useQuery({
    queryKey: ["report-export-source", params.reportId],
    queryFn: () => getReportExportSource(params.reportId) as Promise<ExportSourcePayload>,
  });

  async function exportFullPdf(profileRunId: string) {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await downloadCombinedReport(profileRunId, ALL_COMBINED_REPORT_SECTIONS, params.reportId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `full-profile-report-${params.reportId.slice(0, 8)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  }

  if (reportQuery.isPending) {
    return (
      <main className="page">
        <div className="panel" style={{ padding: "2rem", textAlign: "center" }}>
          <p className="muted">⏳ Đang tổng hợp báo cáo hoàn chỉnh từ dữ liệu Profiling và các Biểu đồ…</p>
        </div>
      </main>
    );
  }

  if (reportQuery.isError || !reportQuery.data) {
    return (
      <main className="page">
        <div className="panel" style={{ padding: "2rem" }}>
          <ErrorNotice error={reportQuery.error} />
          <div style={{ marginTop: "1rem" }}>
            <Link className="button secondary" href="/reports">← Quay lại danh sách báo cáo</Link>
          </div>
        </div>
      </main>
    );
  }

  const { profile, report_snapshot } = reportQuery.data;
  const items = report_snapshot?.items ?? [];
  const run = profile.run;
  const datasetName = profile.dataset?.name || "Tập dữ liệu chưa đặt tên";

  const tocItems: Array<{ id: string; title: string }> = [
    { id: "sec-overview", title: "1. Tổng quan Dataset & Hồ sơ Scan" },
  ];
  if (run.narrative_report) {
    tocItems.push({ id: "sec-narrative", title: "2. Đánh giá tổng quát từ AI Agent" });
  }
  if (run.risk_warnings && run.risk_warnings.length > 0) {
    tocItems.push({ id: "sec-quality", title: "3. Cảnh báo chất lượng dữ liệu" });
  }
  if (profile.column_stats && profile.column_stats.length > 0) {
    tocItems.push({ id: "sec-columns", title: "4. Thống kê đặc trưng các cột" });
  }
  if (items.length > 0) {
    tocItems.push({ id: "sec-charts", title: "5. Bằng chứng Biểu đồ & Insight chuyên sâu" });
  }

  return (
    <>
      <main className="page report-detail-page" style={{ maxWidth: "1000px", margin: "0 auto", paddingBottom: "5rem" }}>
        {/* TOP TOOLBAR */}
        <div className="report-detail-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Link className="button secondary" href="/reports">← Danh sách báo cáo</Link>
            <span className="chip success">Bản tổng hợp hoàn chỉnh</span>
          </div>
          {run.id && (
            <button
              type="button"
              className="button primary"
              onClick={() => void exportFullPdf(run.id)}
              disabled={exporting}
              style={{
                background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
                boxShadow: "0 4px 12px rgba(37,99,235,0.25)",
                fontWeight: 700,
              }}
            >
              {exporting ? "⏳ Đang tạo PDF chuẩn xuất bản…" : "📄 Xuất bản file PDF đầy đủ"}
            </button>
          )}
        </div>

        {exportError !== null && <ErrorNotice error={exportError} />}

        {/* REPORT HEADER BANNER */}
        <div className="panel report-hero-banner" style={{
          background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
          color: "#ffffff",
          padding: "2.5rem",
          borderRadius: "16px",
          marginBottom: "2rem",
          boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)",
        }}>
          <span style={{ fontSize: "0.85rem", letterSpacing: "0.05em", color: "#93c5fd", textTransform: "uppercase", fontWeight: 700 }}>
            HỒ SƠ DỮ LIỆU & BÁO CÁO PHÂN TÍCH TOÀN DIỆN
          </span>
          <h1 style={{ fontSize: "2rem", margin: "0.5rem 0 1rem 0", color: "#ffffff", fontWeight: 800 }}>
            {report_snapshot?.title || `Báo cáo phân tích: ${datasetName}`}
          </h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", fontSize: "0.9rem", color: "#cbd5e1", borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: "1rem" }}>
            <div>📊 <b>Tập dữ liệu:</b> {datasetName}</div>
            <div>🔢 <b>Quy mô:</b> {run.row_count ? run.row_count.toLocaleString("vi-VN") : "0"} dòng</div>
            <div>⚡ <b>Chế độ Scan:</b> {run.scan_mode === "full" ? "Full Scan (Toàn bộ)" : "Sample Scan"}</div>
            <div>🕒 <b>Ngày tạo:</b> {run.created_at ? new Date(run.created_at).toLocaleDateString("vi-VN") : "—"}</div>
          </div>
        </div>

        {/* 1. DATASET & PROFILE OVERVIEW */}
        <section id="sec-overview" className="panel report-detail-section" style={{ padding: "2rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.35rem", marginBottom: "1rem", color: "#0f172a", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>
            1. Tổng quan Dataset & Kết quả Profiling
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", margin: "1rem 0" }}>
            <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "0.8rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Tổng số dòng</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b", marginTop: "0.25rem" }}>
                {run.row_count ? run.row_count.toLocaleString("vi-VN") : "—"}
              </div>
            </div>
            <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "0.8rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Số lượng cột</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b", marginTop: "0.25rem" }}>
                {profile.column_stats?.length || 0} cột
              </div>
            </div>
            <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "0.8rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Trạng thái hồ sơ</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#059669", marginTop: "0.25rem" }}>
                {run.status === "completed" ? "Hoàn tất" : run.status || "Sẵn sàng"}
              </div>
            </div>
          </div>
        </section>

        {/* 2. AGENT NARRATIVE SUMMARY */}
        {run.narrative_report && (
          <section id="sec-narrative" className="panel report-detail-section" style={{ padding: "2rem", marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.35rem", marginBottom: "1rem", color: "#0f172a", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>
              2. Đánh giá tổng quát từ AI Agent
            </h2>
            <div style={{ background: "rgba(59, 130, 246, 0.04)", borderLeft: "4px solid #3b82f6", padding: "1.25rem", borderRadius: "0 8px 8px 0" }}>
              <MarkdownContent text={run.narrative_report} className="report report-markdown" />
            </div>
          </section>
        )}

        {/* 3. DATA QUALITY WARNINGS */}
        {run.risk_warnings && run.risk_warnings.length > 0 && (
          <section id="sec-quality" className="panel report-detail-section" style={{ padding: "2rem", marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.35rem", marginBottom: "1rem", color: "#0f172a", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>
              3. Cảnh báo chất lượng dữ liệu & Rủi ro
            </h2>
            <ul style={{ paddingLeft: "1.25rem", margin: "0.5rem 0", color: "#b45309", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {run.risk_warnings.map((warning, index) => (
                <li key={index} style={{ background: "#fffbeb", padding: "0.75rem 1rem", borderRadius: "6px", border: "1px solid #fde68a" }}>
                  ⚠️ {warning}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 4. COLUMN STATISTICS TABLE */}
        {profile.column_stats && profile.column_stats.length > 0 && (
          <section id="sec-columns" className="panel report-detail-section" style={{ padding: "2rem", marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.35rem", marginBottom: "1rem", color: "#0f172a", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>
              4. Thống kê đặc trưng các cột
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #cbd5e1" }}>
                    <th style={{ padding: "0.75rem" }}>Tên Cột</th>
                    <th style={{ padding: "0.75rem" }}>Kiểu dữ liệu</th>
                    <th style={{ padding: "0.75rem" }}>Tỷ lệ thiếu (Null%)</th>
                    <th style={{ padding: "0.75rem" }}>Số giá trị duy nhất</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.column_stats.map((col, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0", background: idx % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                      <td style={{ padding: "0.75rem", fontWeight: 600 }}>{col.column_name}</td>
                      <td style={{ padding: "0.75rem", color: "#64748b" }}><code>{col.inferred_type || "string"}</code></td>
                      <td style={{ padding: "0.75rem", color: (col.null_percentage || 0) > 20 ? "#dc2626" : "#475569" }}>
                        {((col.null_percentage || 0) * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: "0.75rem", color: "#475569" }}>
                        {col.distinct_count ? col.distinct_count.toLocaleString("vi-VN") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 5. PINNED CHARTS & AGENT INSIGHTS */}
        <section id="sec-charts" style={{ marginTop: "2rem" }}>
          <div style={{ marginBottom: "1rem" }}>
            <span className="eyebrow" style={{ color: "#2563eb", fontWeight: 700, textTransform: "uppercase", fontSize: "0.8rem" }}>
              CHUYÊN ĐỀ PHÂN TÍCH CHUYÊN SÂU
            </span>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a", margin: "0.25rem 0" }}>
              5. Bằng chứng Biểu đồ & AI Insight đã ghim ({items.length} mục)
            </h2>
          </div>

          {items.length === 0 ? (
            <div className="panel" style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
              Chưa có biểu đồ nào được ghim vào báo cáo này. Hãy vào Workspace Biểu đồ và ghim các bài phân tích để hiển thị ở đây.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
              {items.map((item, index) => (
                <article
                  id={`item-${item.id}`}
                  className="panel report-detail-section"
                  key={item.id}
                  style={{
                    padding: "2rem",
                    borderRadius: "12px",
                    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.05)",
                  }}
                >
                  <header style={{ marginBottom: "1.25rem", borderBottom: "1px solid #e2e8f0", paddingBottom: "1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="eyebrow" style={{ textTransform: "uppercase", fontSize: "0.75rem", color: "#2563eb", fontWeight: 700 }}>
                        {item.item_type === "chart" ? `BẰNG CHỨNG #${index + 1}` : `GHI CHÚ #${index + 1}`}
                      </span>
                      {item.query_spec && (
                        <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: "4px" }}>
                          {item.query_spec.aggregate} · {item.query_spec.analysis_kind}
                        </span>
                      )}
                    </div>
                    <h3 style={{ fontSize: "1.3rem", fontWeight: 700, margin: "0.5rem 0", color: "#1e293b" }}>
                      {item.title || (item.item_type === "chart" ? "Biểu đồ Phân tích" : "Kết luận từ Agent")}
                    </h3>
                  </header>

                  {/* CHART RENDERER */}
                  {item.item_type === "chart" && item.content_json?.result && item.content_json.chart_spec && item.query_spec && (
                    <div className="report-chart-box" style={{ margin: "1.5rem 0", background: "#ffffff", padding: "1rem", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                      <ChartEvidenceView
                        chartSpec={item.content_json.chart_spec}
                        result={item.content_json.result}
                        querySpec={item.query_spec}
                        title={item.title || undefined}
                      />
                    </div>
                  )}

                  {/* AGENT INSIGHT BOX */}
                  {item.content_json?.insight && (
                    <div
                      className="report-insight-box"
                      style={{
                        background: "rgba(99, 102, 241, 0.04)",
                        borderLeft: "4px solid #6366f1",
                        padding: "1.25rem 1.5rem",
                        borderRadius: "0 8px 8px 0",
                        marginTop: "1.25rem",
                      }}
                    >
                      <span className="eyebrow" style={{ fontSize: "0.75rem", fontWeight: 700, color: "#4f46e5", display: "block", marginBottom: "0.5rem" }}>
                        💡 INSIGHT & KẾT LUẬN TỪ AI AGENT
                      </span>
                      <MarkdownContent text={item.content_json.insight} className="report report-markdown" />
                    </div>
                  )}

                  {/* AGENT ANSWER */}
                  {item.content_json?.answer && (
                    <div className="report-answer-box" style={{ padding: "1.25rem", background: "#f8fafc", borderRadius: "8px", marginTop: "1rem", border: "1px solid #e2e8f0" }}>
                      <MarkdownContent text={item.content_json.answer} className="report report-markdown" />
                    </div>
                  )}

                  {/* USER NOTE */}
                  {item.note && (
                    <div className="report-note-box" style={{ marginTop: "1rem", padding: "0.75rem 1rem", background: "#fefce8", border: "1px solid #fef08a", borderRadius: "6px", fontStyle: "italic", color: "#854d0e", fontSize: "0.85rem" }}>
                      <b>Ghi chú người dùng:</b> {item.note}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* STICKY SIDEBAR TABLE OF CONTENTS */}
      {tocItems.length > 0 && (
        <aside className="report-toc-sidebar">
          <div className="report-toc-container">
            <h3 className="report-toc-title" style={{ fontSize: "0.95rem", fontWeight: 700, color: "#0f172a", marginBottom: "0.75rem", borderBottom: "1px solid #f1f5f9", paddingBottom: "0.5rem" }}>
              📑 Mục Lục Báo Cáo
            </h3>
            <ul className="report-toc-list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
              {tocItems.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" });
                    }}
                    style={{ color: "#2563eb", textDecoration: "none", display: "block", padding: "4px 0" }}
                  >
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

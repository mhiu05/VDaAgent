import React from "react";

import type { AnswerSource } from "@/lib/types";

function toolEvidenceLabel(source: Extract<AnswerSource, { type: "tool" }>): string {
  const labels: Record<string, string> = {
    get_profile_overview: "Tổng quan Profile Run",
    get_column_profile: "Thống kê cột",
    get_distribution: "Phân phối theo nhóm",
    get_missingness_patterns: "Phân tích giá trị thiếu",
    get_duplicate_analysis: "Phân tích bản ghi trùng",
    get_candidate_keys: "Kiểm tra candidate key",
    list_quality_issues: "Kiểm tra chất lượng dữ liệu",
    get_correlation: "Tương quan giữa các cột",
    get_top_correlations: "Các tương quan mạnh nhất",
  };
  const column = typeof source.args?.column_name === "string" ? source.args.column_name : null;
  return `${labels[source.tool] || source.tool}${column ? ` · ${column}` : ""}`;
}

function evidenceStatusLabel(status: string): string {
  return status === "ok" ? "đã kiểm chứng" : status;
}

function safeHttpUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

export function AnswerSources({ sources }: { sources?: AnswerSource[] }) {
  if (!sources?.length) return null;

  return (
    <details className="answer-sources-details" aria-label="Nguồn trả lời & Tài liệu tham khảo">
      <summary className="answer-sources-summary">
        <span className="answer-sources-summary-icon">📚</span>
        <span className="answer-sources-summary-title">Bằng chứng đã dùng</span>
        <span className="answer-sources-count-badge">{sources.length}</span>
        <span className="answer-sources-chevron" aria-hidden="true">▼</span>
      </summary>

      <div className="answer-sources-list">
        {sources.map((source, idx) => {
          if (source.type === "profile_report") {
            const citationKey = source.citation_id || `S${idx + 1}`;
            return (
              <div className="answer-source-card profile" id={`citation-${citationKey}`} key={citationKey}>
                <div className="answer-source-header">
                  <span className="answer-source-badge profile">[{citationKey}] Bằng chứng Profile</span>
                  <span className="answer-source-name">📊 {source.dataset_name || "Bộ dữ liệu"}</span>
                </div>
              </div>
            );
          }

          if (source.type === "external_knowledge") {
            const citationKey = source.citation_id || `S${idx + 1}`;
            const url = safeHttpUrl(source.canonical_url);
            return (
              <div className="answer-source-card knowledge" id={`citation-${citationKey}`} key={citationKey}>
                <div className="answer-source-header">
                  <span className="answer-source-badge knowledge">[{citationKey}] Tài liệu tham khảo</span>
                  {source.retrieved_at && (
                    <span className="answer-source-date">
                      📅 {new Date(source.retrieved_at).toLocaleDateString("vi-VN")}
                    </span>
                  )}
                </div>
                <div className="answer-source-content">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="answer-source-link"
                    >
                      <span>🔗 {source.title || new URL(url).hostname}</span>
                      <small className="answer-source-url-hint">({new URL(url).hostname}) ↗</small>
                    </a>
                  ) : (
                    <span className="answer-source-text">📄 {source.title || "Nguồn tham khảo"}</span>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div className="answer-source-card tool" id={`citation-${("citation_id" in source ? source.citation_id : undefined) || `S${idx + 1}`}`} key={`${source.tool}-${source.status}-${idx}`}>
              <div className="answer-source-header">
                <span className="answer-source-badge tool">⚡ Bằng chứng hệ thống</span>
                <span className="answer-source-name">{toolEvidenceLabel(source)} · {evidenceStatusLabel(source.status)}</span>
              </div>
              {source.profile_run_id && <small className="answer-source-text">Profile Run: {source.profile_run_id}</small>}
            </div>
          );
        })}
      </div>
    </details>
  );
}

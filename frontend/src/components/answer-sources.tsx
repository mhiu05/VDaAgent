import type { AnswerSource } from "@/lib/types";

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
        <span className="answer-sources-summary-title">Tài liệu tham khảo & Nguồn trích dẫn</span>
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
                  <span className="answer-source-badge profile">[{citationKey}] Profile Evidence</span>
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
            <div className="answer-source-card tool" key={`${source.tool}-${source.status}-${idx}`}>
              <div className="answer-source-header">
                <span className="answer-source-badge tool">⚡ Tool Evidence</span>
                <span className="answer-source-name">{source.tool} · {source.status}</span>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

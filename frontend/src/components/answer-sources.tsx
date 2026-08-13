import type { AnswerSource } from "@/lib/types";

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

export function AnswerSources({ sources }: { sources?: AnswerSource[] }) {
  if (!sources?.length) return null;
  return <section className="answer-sources" aria-label="Nguồn trả lời">
    {sources.map((source) => {
      if (source.type === "profile_report") return <div className="answer-source" id={`citation-${source.citation_id}`} key={source.citation_id}>
        <b>Profile evidence {`[${source.citation_id}]`}</b><span>{source.dataset_name || "Dataset"}</span>
      </div>;
      if (source.type === "external_knowledge") {
        const url = safeHttpUrl(source.canonical_url);
        return <div className="answer-source" id={`citation-${source.citation_id}`} key={source.citation_id}>
          <b>Tài liệu tham khảo {`[${source.citation_id}]`}</b>
          {url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.title || new URL(url).hostname}</a> : <span>{source.title || "Nguồn ngoài"}</span>}
          {source.retrieved_at ? <small>{new Date(source.retrieved_at).toLocaleDateString("vi-VN")}</small> : null}
        </div>;
      }
      return <div className="answer-source" key={`${source.tool}-${source.status}`}><b>Tool evidence</b><span>{source.tool} · {source.status}</span></div>;
    })}
  </section>;
}

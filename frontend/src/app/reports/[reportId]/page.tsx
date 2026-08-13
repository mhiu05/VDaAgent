"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getPublishedReport } from "@/lib/api";

type Visualization = { id: string; chart_type: string; title: string | null; result_snapshot: { rows?: Array<Record<string, unknown>>; value?: unknown } };
type Report = { title: string; versions: Array<{ executive_summary?: string; sections: Array<{ id: string; kind: string; title?: string; content_json: { text?: string } }>; visualizations: Visualization[]; published_at?: string }> };

export default function ReportPage() {
  const params = useParams<{ reportId: string }>();
  const report = useQuery({ queryKey: ["published-report", params.reportId], queryFn: () => getPublishedReport<Report>(params.reportId) });
  if (report.isPending) return <main className="page"><p>Đang tải report…</p></main>;
  if (report.isError || !report.data) return <main className="page"><p role="alert">{report.error?.message ?? "Không tìm thấy report."}</p></main>;
  const version = report.data.versions[0];
  return <main className="page"><h1>{report.data.title}</h1>{version?.executive_summary && <section className="panel"><h2>Tóm tắt điều hành</h2><p>{version.executive_summary}</p></section>}{version?.sections.map((section) => <section className="panel" key={section.id}><h2>{section.title || section.kind}</h2><p>{section.content_json.text || "—"}</p></section>)}{version?.visualizations.map((visualization) => <section className="panel" key={visualization.id}><h2>{visualization.title || visualization.chart_type}</h2><pre>{JSON.stringify(visualization.result_snapshot, null, 2)}</pre></section>)}</main>;
}

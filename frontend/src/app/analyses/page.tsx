"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { listAnalyses } from "@/lib/api";
import { EmptyState, ErrorNotice, LoadingBlock, PageHeader, StatusBadge } from "@/components/ui";

export default function AnalysesPage() {
  const analyses = useQuery({ queryKey: ["analyses"], queryFn: ({ signal }) => listAnalyses(signal) });
  if (analyses.isLoading) return <LoadingBlock label="Đang tải analysis sessions…" />;
  if (analyses.isError) return <ErrorNotice error={analyses.error} retry={() => analyses.refetch()} />;
  return <>
    <PageHeader eyebrow="Data Analyst workspace" title="Analyses" description="Business work được pin vào một profile version, context và evidence riêng." action={<Link className="button primary" href="/analyses/new">Start analysis</Link>} />
    {!analyses.data?.length ? <EmptyState title="Chưa có analysis session" detail="Bắt đầu từ profile đã completed để tạo câu trả lời có evidence." action={<Link className="button primary" href="/datasets">Mở datasets</Link>} /> : <section className="panel"><div className="table-wrap"><table><thead><tr><th>Goal</th><th>Mode</th><th>Status</th><th>Created</th><th /></tr></thead><tbody>{analyses.data.map((item) => <tr key={item.id}><td><b>{item.goal}</b><br /><small>{item.source?.profile_run_id || "Pinned source"}</small></td><td>{item.mode === "quick" ? "Quick Answer" : "Deep Analysis"}</td><td><StatusBadge status={item.status} /></td><td>{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</td><td><Link className="button ghost" href={`/analyses/${item.id}`}>Open</Link></td></tr>)}</tbody></table></div></section>}
  </>;
}

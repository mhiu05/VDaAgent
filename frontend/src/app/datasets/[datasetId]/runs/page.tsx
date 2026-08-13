"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createProfileReport, listRuns } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { EmptyState, ErrorNotice, LoadingBlock, PageHeader, StatusBadge } from "@/components/ui";

export default function DatasetRunsPage() {
  const params = useParams<{ datasetId: string }>();
  const router = useRouter();
  const datasetId = params.datasetId;
  const [exportingRunId, setExportingRunId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);
  const runs = useQuery({ queryKey: ["runs", datasetId], queryFn: ({ signal }) => listRuns(datasetId, signal), enabled: Boolean(datasetId) });

  async function exportReport(runId: string) {
    setExportingRunId(runId);
    setExportError(null);
    try {
      const report = await createProfileReport<{ id: string }>(runId);
      router.push(`/reports/${encodeURIComponent(report.id)}`);
    } catch (error) {
      setExportError(error);
      setExportingRunId(null);
    }
  }

  return <>
    <PageHeader eyebrow="Lịch sử profiling" title="Các profile run" description={`ID bộ dữ liệu: ${datasetId}`} action={<Link href="/datasets/new" className="button primary">Profiling phiên bản mới</Link>} />
    {runs.isLoading && <LoadingBlock />}
    {runs.isError && <ErrorNotice error={runs.error} retry={() => runs.refetch()} />}
    {exportError && <ErrorNotice error={exportError} />}
    {runs.data?.length === 0 && <EmptyState title="Chưa có profile run" detail="Bộ dữ liệu này chưa được profiling thành công." />}
    {!!runs.data?.length && <section className="panel"><div className="table-wrap"><table><thead><tr><th>Run</th><th>Trạng thái</th><th>Scan</th><th>Số dòng</th><th>Thời điểm</th><th /></tr></thead><tbody>{runs.data.map((run) => <tr key={run.id}><td><b>v{run.version ?? "—"}</b><br /><small>{run.id}</small></td><td><StatusBadge status={run.status} /></td><td>{run.scan_mode || "—"}{run.is_approximate && " ≈"}</td><td>{formatNumber(run.row_count)}</td><td>{formatDate(run.created_at)}</td><td><div className="inline-actions"><Link href={`/profiles/${run.id}`} className="button secondary">Mở báo cáo</Link>{run.status === "completed" && <button type="button" className="button primary" onClick={() => void exportReport(run.id)} disabled={exportingRunId !== null}>{exportingRunId === run.id ? "Đang tạo báo cáo…" : "Xuất báo cáo"}</button>}</div></td></tr>)}</tbody></table></div></section>}
  </>;
}

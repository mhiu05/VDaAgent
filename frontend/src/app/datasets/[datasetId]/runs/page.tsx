"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createProfile, createProfileReport, listRuns } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { EmptyState, ErrorNotice, LoadingBlock, PageHeader, StatusBadge } from "@/components/ui";

export default function DatasetRunsPage() {
  const params = useParams<{ datasetId: string }>();
  const router = useRouter();
  const datasetId = params.datasetId;
  const [exportingRunId, setExportingRunId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);
  const [scanMode, setScanMode] = useState<"sample" | "full">("sample");
  const [profiling, setProfiling] = useState(false);
  const [profileError, setProfileError] = useState<unknown>(null);
  const runs = useQuery({ queryKey: ["runs", datasetId], queryFn: ({ signal }) => listRuns(datasetId, signal), enabled: Boolean(datasetId) });

  async function profileNewVersion() {
    if (!datasetId) return;
    setProfiling(true);
    setProfileError(null);
    try {
      const profile = await createProfile({
        dataset_id: datasetId,
        scan_mode: scanMode,
        ...(scanMode === "sample" ? { sampling: { strategy: "reservoir" } } : {}),
      });
      router.push(`/profiles/${profile.profile_run_id}`);
    } catch (error) {
      setProfileError(error);
      setProfiling(false);
    }
  }

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
    <PageHeader
      eyebrow="Lịch sử profiling"
      title="Các profile run"
      description={`ID bộ dữ liệu: ${datasetId}`}
      action={<div className="inline-actions"><select aria-label="Chế độ scan cho phiên bản mới" value={scanMode} onChange={(event) => setScanMode(event.target.value as "sample" | "full")} disabled={profiling}><option value="sample">Sample scan</option><option value="full">Full scan</option></select><button type="button" className="button primary" onClick={() => void profileNewVersion()} disabled={profiling}>{profiling ? "Đang profiling…" : "Profiling phiên bản mới"}</button></div>}
    />
    {runs.isLoading && <LoadingBlock />}
    {runs.isError && <ErrorNotice error={runs.error} retry={() => runs.refetch()} />}
    {exportError && <ErrorNotice error={exportError} />}
    {profileError && <ErrorNotice error={profileError} retry={profileNewVersion} />}
    {runs.data?.length === 0 && <EmptyState title="Chưa có profile run" detail="Bộ dữ liệu này chưa được profiling thành công. Chọn chế độ scan rồi bấm “Profiling phiên bản mới” để chạy trực tiếp từ file đã lưu." />}
    {!!runs.data?.length && <section className="panel"><div className="table-wrap"><table><thead><tr><th>Run</th><th>Trạng thái</th><th>Scan</th><th>Số dòng</th><th>Thời điểm</th><th /></tr></thead><tbody>{runs.data.map((run) => <tr key={run.id}><td><b>v{run.version ?? "—"}</b><br /><small>{run.id}</small></td><td><StatusBadge status={run.status} /></td><td>{run.scan_mode || "—"}{run.is_approximate && " ≈"}</td><td>{formatNumber(run.row_count)}</td><td>{formatDate(run.created_at)}</td><td><div className="inline-actions"><Link href={`/profiles/${run.id}`} className="button secondary">Mở báo cáo</Link>{run.status === "completed" && <button type="button" className="button primary" onClick={() => void exportReport(run.id)} disabled={exportingRunId !== null}>{exportingRunId === run.id ? "Đang tạo báo cáo…" : "Xuất báo cáo"}</button>}</div></td></tr>)}</tbody></table></div></section>}
  </>;
}

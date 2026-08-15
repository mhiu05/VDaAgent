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
  const [runName, setRunName] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [profiling, setProfiling] = useState(false);
  const [profileError, setProfileError] = useState<unknown>(null);
  const runs = useQuery({ queryKey: ["runs", datasetId], queryFn: ({ signal }) => listRuns(datasetId, signal), enabled: Boolean(datasetId) });

  function openCreateModal() {
    const nextVersion = (runs.data?.[0]?.version ?? 0) + 1;
    setRunName(`Phiên bản v${nextVersion}`);
    setScanMode("sample");
    setProfileError(null);
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    if (!profiling) setIsCreateModalOpen(false);
  }

  async function profileNewVersion() {
    const normalizedRunName = runName.trim();
    if (!datasetId || !normalizedRunName) return;
    setProfiling(true);
    setProfileError(null);
    try {
      const profile = await createProfile({
        dataset_id: datasetId,
        run_name: normalizedRunName,
        scan_mode: scanMode,
        ...(scanMode === "sample" ? { sampling: { strategy: "reservoir" } } : {}),
      });
      setIsCreateModalOpen(false);
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
      description="Theo dõi và tạo các phiên profiling của bộ dữ liệu này."
      action={<button type="button" className="button primary" onClick={openCreateModal}>Profiling phiên bản mới</button>}
    />
    {runs.isLoading && <LoadingBlock />}
    {runs.isError && <ErrorNotice error={runs.error} retry={() => runs.refetch()} />}
    {exportError && <ErrorNotice error={exportError} />}
    {Boolean(profileError) && !isCreateModalOpen && <ErrorNotice error={profileError} retry={() => void profileNewVersion()} />}
    {runs.data?.length === 0 && <EmptyState title="Chưa có profile run" detail="Bộ dữ liệu này chưa được profiling thành công. Hãy tạo phiên profiling mới để bắt đầu." />}
    {!!runs.data?.length && <section className="panel"><div className="table-wrap"><table><thead><tr><th>Phiên profiling</th><th>Trạng thái</th><th>Scan</th><th>Số dòng</th><th>Thời điểm</th><th /></tr></thead><tbody>{runs.data.map((run) => <tr key={run.id}><td><b>{run.run_name || `Phiên bản v${run.version ?? "—"}`}</b><br /><small>Phiên bản v{run.version ?? "—"} · ID được quản lý nội bộ</small></td><td><StatusBadge status={run.status} /></td><td>{run.scan_mode || "—"}{run.is_approximate && " ≈"}</td><td>{formatNumber(run.row_count)}</td><td>{formatDate(run.created_at)}</td><td><div className="inline-actions"><Link href={`/profiles/${run.id}`} className="button secondary">Mở báo cáo</Link>{run.status === "completed" && <button type="button" className="button primary" onClick={() => void exportReport(run.id)} disabled={exportingRunId !== null}>{exportingRunId === run.id ? "Đang tạo báo cáo…" : "Xuất báo cáo"}</button>}</div></td></tr>)}</tbody></table></div></section>}

    {isCreateModalOpen && <div className="profile-modal-backdrop" role="presentation" onClick={closeCreateModal}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="new-profile-run-title" onClick={(event) => event.stopPropagation()}>
        <header className="profile-modal-header">
          <div><p className="eyebrow">PHIÊN PROFILING MỚI</p><h2 id="new-profile-run-title">Thiết lập lần chạy</h2><p>Đặt tên để dễ chọn phiên này trong Chat Agent, kiểm định và so sánh drift.</p></div>
          <button type="button" className="history-modal-close" aria-label="Đóng" onClick={closeCreateModal} disabled={profiling}>×</button>
        </header>
        <div className="profile-modal-body">
          <label className="profile-modal-field" htmlFor="profile-run-name"><span>Tên phiên profiling</span><input id="profile-run-name" value={runName} onChange={(event) => setRunName(event.target.value)} maxLength={255} autoFocus placeholder="Ví dụ: Sau khi làm sạch dữ liệu" disabled={profiling} /></label>
          <p className="field-hint">Tên phiên không làm thay đổi tên bộ dữ liệu gốc.</p>
          <fieldset className="profile-modal-scan-options" disabled={profiling}><legend>Chế độ scan</legend>
            <label className={scanMode === "sample" ? "selected" : ""}><input type="radio" name="scan-mode" value="sample" checked={scanMode === "sample"} onChange={() => setScanMode("sample")} /><span><b>Sample scan</b><small>Nhanh, phù hợp để kiểm tra sơ bộ.</small></span></label>
            <label className={scanMode === "full" ? "selected" : ""}><input type="radio" name="scan-mode" value="full" checked={scanMode === "full"} onChange={() => setScanMode("full")} /><span><b>Full scan</b><small>Quét toàn bộ dữ liệu, chính xác hơn.</small></span></label>
          </fieldset>
          {Boolean(profileError) && <ErrorNotice error={profileError} retry={() => void profileNewVersion()} />}
        </div>
        <footer className="profile-modal-actions"><button type="button" className="button secondary" onClick={closeCreateModal} disabled={profiling}>Hủy</button><button type="button" className="button primary" onClick={() => void profileNewVersion()} disabled={profiling || !runName.trim()}>{profiling ? "Đang tạo phiên…" : "Bắt đầu profiling"}</button></footer>
      </section>
    </div>}
  </>;
}

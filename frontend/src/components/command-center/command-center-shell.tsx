"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { getProfile, getProfilingJob } from "@/lib/api";
import { ErrorNotice, LoadingBlock, Notice, StatusBadge } from "@/components/ui";

type Props = { overview: ReactNode };

function confidenceLabel(scanMode?: string | null, approximate?: boolean) {
  if (approximate || scanMode === "sample") return "Preview · sample";
  return "Exact · full source";
}

export function CommandCenterShell({ overview }: Props) {
  const { runId } = useParams<{ runId: string }>();
  const profile = useQuery({
    queryKey: ["profile", runId], queryFn: ({ signal }) => getProfile(runId, signal), enabled: Boolean(runId),
    refetchInterval: (query) => ["created", "queued", "running", "resuming"].includes(query.state.data?.status || "") ? 3_000 : false,
  });
  const job = useQuery({
    queryKey: ["profiling-job", runId],
    queryFn: ({ signal }) => getProfilingJob(runId, signal),
    enabled: Boolean(runId),
    retry: false,
    refetchInterval: (query) => ["queued", "running"].includes(query.state.data?.status || "") ? 3_000 : false,
  });

  if (profile.isLoading) return <LoadingBlock label="Đang tải Command Center…" />;
  if (profile.isError) return <ErrorNotice error={profile.error} retry={() => profile.refetch()} />;
  if (!profile.data) return <Notice tone="warning">Profile không tồn tại hoặc bạn không còn quyền truy cập.</Notice>;
  const data = profile.data;

  return <main className="page command-center" aria-labelledby="command-center-title">
    <div style={{ marginBottom: "1rem" }}>
      <Link href="/datasets" className="button secondary">← Quay lại Datasets</Link>
    </div>
    <header className="command-center-header">
      <div>
        <p className="eyebrow">PROFILE RUN COMMAND CENTER</p>
        <h1 id="command-center-title">{data.dataset_name || "Dataset"}</h1>
        <p className="muted">{data.run_name || "Profile run"} · v{data.version ?? "-"}</p>
      </div>
      <div className="command-center-status" aria-label="Thông tin profile run">
        <span className="chip">{data.scan_mode || "unknown"} scan</span>
        <StatusBadge status={data.status} />
        <span className={data.is_approximate ? "chip warning" : "chip"}>{confidenceLabel(data.scan_mode, data.is_approximate)}</span>
        {data.pending_proposals > 0 && <span className="chip pii">{data.pending_proposals} đề xuất cần review</span>}
      </div>
    </header>

    {job.data?.status === "queued" && <Notice><b>Profiling đã được xếp hàng.</b><p>Worker sẽ bắt đầu khi còn dung lượng xử lý. Bạn có thể đóng trang và quay lại bằng profile run này.</p></Notice>}
    {job.data?.status === "running" && <Notice><b>Profiling đang chạy.</b><p>Hệ thống đang tính thống kê và chuẩn bị đề xuất. Trang tự cập nhật; không cần gửi lại yêu cầu.</p></Notice>}
    {job.data?.status === "failed" && <Notice tone="warning"><b>Profiling không hoàn thành.</b><p>{job.data.error?.message || "Hãy kiểm tra dataset rồi tạo một profile run mới."}</p></Notice>}
    {data.status === "failed" && <Notice tone="warning"><b>Profile chạy thất bại.</b><p>{data.error || "Hãy kiểm tra source và bắt đầu một profile run mới."}</p><Link className="button secondary" href={`/datasets/${data.dataset_id}/runs`}>Mở profile runs</Link></Notice>}
    <section className="command-center-panel">
      {overview}
    </section>
  </main>;
}

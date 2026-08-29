"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { getProfileSummary, streamProfileEvents } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { deriveCommandCenterState, commandCenterStateLabel, newestProfileSummary } from "@/lib/profile-state";
import { profileQueryKey, profileSummaryQueryKey } from "@/lib/profile-query-keys";
import type { ProfileSummary } from "@/lib/types";
import { ErrorNotice, Notice, StatusBadge } from "@/components/ui";
import { ProfileReviewPanel } from "@/components/profile-review-panel";

type Props = { overview: ReactNode };

function confidenceLabel(scanMode?: string | null) {
  return scanMode === "sample" ? "Preview · sample" : scanMode === "full" ? "Exact · full source" : "Scan pending";
}

export function CommandCenterShell({ overview }: Props) {
  const { runId } = useParams<{ runId: string }>();
  const { workspaceId } = useAuth();
  const queryClient = useQueryClient();
  const [sseConnected, setSseConnected] = useState(false);
  const [sseDisabled, setSseDisabled] = useState(false);
  const seenEventIds = useRef(new Set<string>());
  const terminalEvent = useRef(false);
  const previousState = useRef<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const summary = useQuery({
    queryKey: profileSummaryQueryKey(workspaceId, runId),
    queryFn: async ({ signal }) => {
      const incoming = await getProfileSummary(runId, signal);
      return newestProfileSummary(
        queryClient.getQueryData<ProfileSummary>(profileSummaryQueryKey(workspaceId, runId)), incoming,
      );
    },
    enabled: Boolean(runId && workspaceId),
    refetchInterval: (query) => {
      const state = deriveCommandCenterState(query.state.data);
      return !query.state.error && !sseConnected && ["queued", "profiling", "resuming"].includes(state) ? 3_000 : false;
    },
  });

  useEffect(() => {
    seenEventIds.current.clear();
    terminalEvent.current = false;
    previousState.current = null;
    setReviewOpen(false);
    setSseDisabled(false);
  }, [runId, workspaceId]);

  const data = summary.data;
  const state = deriveCommandCenterState(data);
  const canStream = Boolean(data) && state !== "ready" && state !== "failed";

  useEffect(() => {
    if (!sseDisabled || !canStream) return;
    // Continue the inexpensive summary poll, then make one bounded probe after
    // a network/proxy outage. This recovers SSE without keeping both channels
    // active in a reconnect loop.
    const retryTimer = window.setTimeout(() => setSseDisabled(false), 30_000);
    return () => window.clearTimeout(retryTimer);
  }, [canStream, sseDisabled]);

  useEffect(() => {
    if (!runId || !workspaceId || !canStream || sseDisabled || typeof ReadableStream === "undefined") return;
    const controller = new AbortController();
    let stopped = false;
    let failures = 0;
    let retryTimer: number | undefined;

    const retryOrFallBack = () => {
      if (failures >= 3) {
        setSseDisabled(true);
        setSseConnected(false);
        return;
      }
      retryTimer = window.setTimeout(connect, Math.min(10_000, 1_000 * 2 ** (failures - 1)));
    };

    const connect = async () => {
      const connectedAt = Date.now();
      let receivedMilestone = false;
      try {
        await streamProfileEvents(runId, (event) => {
          if (stopped || typeof event.data !== "object" || !event.data || !("profile_run_id" in event.data)) return;
          if (event.id && seenEventIds.current.has(event.id)) return;
          if (event.id) seenEventIds.current.add(event.id);
          // A response header alone is not proof that a proxy is forwarding
          // the stream. Poll until the first persisted milestone arrives.
          receivedMilestone = true;
          setSseConnected(true);
          const eventSummary = event.data;
          queryClient.setQueryData(profileSummaryQueryKey(workspaceId, runId), eventSummary);
          if (["ready", "failed"].includes(event.event)) {
            terminalEvent.current = true;
          }
        }, controller.signal);
        if (!stopped && !terminalEvent.current) {
          // A proxy that repeatedly opens and closes after one event is not a
          // working stream. Let polling take over instead of reconnecting
          // forever while it suppresses the fallback.
          setSseConnected(false);
          if (receivedMilestone && Date.now() - connectedAt >= 10_000) failures = 0;
          failures += 1;
          retryOrFallBack();
        }
      } catch (error) {
        if (stopped || (error instanceof Error && error.name === "AbortError")) return;
        failures += 1;
        setSseConnected(false);
        retryOrFallBack();
      }
    };
    void connect();
    return () => {
      stopped = true;
      controller.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      setSseConnected(false);
    };
  }, [canStream, queryClient, runId, sseDisabled, workspaceId]);

  useEffect(() => {
    const prior = previousState.current;
    if (state === "review_required" && previousState.current !== "review_required") setReviewOpen(true);
    if (state !== "review_required") setReviewOpen(false);
    if (prior !== null && prior !== state && (state === "ready" || state === "failed")) {
      void queryClient.invalidateQueries({ queryKey: profileQueryKey(workspaceId, runId) });
    }
    previousState.current = state;
  }, [queryClient, runId, state, workspaceId]);

  return <main className="page command-center" aria-labelledby="command-center-title">
    <div style={{ marginBottom: "1rem" }}><Link href="/datasets" className="button secondary">← Quay lại Datasets</Link></div>
    <header className="command-center-header">
      <div><p className="eyebrow">PROFILE RUN COMMAND CENTER</p><h1 id="command-center-title">{data?.dataset_name || (summary.isLoading ? "Dataset đang tải…" : "Dataset")}</h1><p className="muted">{data ? `Profile run · ${data.profile_run_id}` : runId ? `Profile run · ${runId}` : "Profile run"}</p></div>
      <div className="command-center-status" aria-label="Thông tin profile run">
        <span className="chip">{data?.scan_mode || "unknown"} scan</span><StatusBadge status={state} /><span className="chip">{commandCenterStateLabel[state]}</span><span className="chip">{confidenceLabel(data?.scan_mode)}</span>
        {data?.row_count != null && <span className="chip">{data.row_count.toLocaleString()} dòng</span>}{data?.column_count != null && <span className="chip">{data.column_count.toLocaleString()} cột</span>}
        {!!data?.warning_count && <span className="chip warning">{data.warning_count} cảnh báo</span>}{!!data?.pending_proposals && <span className="chip pii">{data.pending_proposals} đề xuất cần review</span>}
      </div>
    </header>

    {summary.isError && <ErrorNotice error={summary.error} retry={() => summary.refetch()} />}
    {summary.isLoading && <Notice><b>Đang khởi tạo Command Center.</b><p>Trạng thái và tóm tắt sẽ xuất hiện ngay khi profile run được nhận diện.</p></Notice>}
    {data && state === "queued" && <Notice><b>Profiling đã được xếp hàng.</b><p>Worker sẽ bắt đầu xử lý; bạn có thể đóng trang và quay lại bằng profile run này.</p></Notice>}
    {data && state === "profiling" && <Notice><b>Profiling đang chạy.</b><p>Trang tự cập nhật; không cần gửi lại yêu cầu.</p></Notice>}
    {data && state === "resuming" && <Notice><b>Đang tiếp tục profile sau review.</b><p>Checkpoint đang được xử lý và trang sẽ tự cập nhật.</p></Notice>}
    {data && state === "review_required" && <><Notice tone="warning"><b>Cần review trước khi tiếp tục.</b><p>Còn {data.pending_proposals} đề xuất cần quyết định.</p><div className="inline-actions">{!reviewOpen && <button type="button" className="button primary" onClick={() => setReviewOpen(true)}>Mở review tại đây</button>}<Link className="button secondary" href={`/profiles/${data.profile_run_id}/review`}>Mở trang review</Link></div></Notice>{reviewOpen && <ProfileReviewPanel runId={data.profile_run_id} onClose={() => setReviewOpen(false)} />}</>}
    {data && state === "failed" && <Notice tone="warning"><b>Profile chạy thất bại.</b><p>Hãy kiểm tra dataset rồi tạo một profile run mới.</p><Link className="button secondary" href={`/datasets/${data.dataset_id}/runs`}>Mở profile runs</Link></Notice>}
    <section className="command-center-panel">{state === "ready" ? overview : null}</section>
  </main>;
}

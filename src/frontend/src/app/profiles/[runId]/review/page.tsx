"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { ApiError, confirmProposals, getProfile } from "@/lib/api";
import { profileQueryKey, profileSummaryQueryKey, profilingJobQueryKey } from "@/lib/profile-query-keys";
import { finalValueOptions, pendingReviewProposals, proposalLabel, proposalValue, reviewDecisions, reviewSelectionsComplete, type ReviewSelection } from "@/lib/profile-review";
import { formatPercent, toTitle } from "@/lib/format";
import { EmptyState, ErrorNotice, LoadingBlock, LoadingButton, Notice, PageHeader, ProgressSteps, StatusBadge } from "@/components/ui";
import type { Profile, Proposal, ProposalDecisionType, ProposalKind } from "@/lib/types";

const profilingStatuses = new Set(["created", "queued", "running"]);
// A resume can outlive one worker lease while another worker recovers it. The
// queue allows up to three attempts, so the UI must keep watching longer than
// the five-minute lease instead of treating a slow but healthy worker as
// failed.
const resumeWatchTimeoutMs = 30 * 60_000;

function profilePreviewPath(runId: string) {
  return `/profiles/${encodeURIComponent(runId)}/preview`;
}

export default function ReviewPage() {
  const { runId } = useParams<{ runId: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const { me, isGuest, workspaceId } = useAuth();
  const [selections, setSelections] = useState<Record<string, ReviewSelection>>({});
  const [resumeError, setResumeError] = useState<Error | null>(null);
  const [resumeWatch, setResumeWatch] = useState(false);
  const reviewRequestKey = useRef<string | null>(null);
  const profile = useQuery({
    queryKey: profileQueryKey(workspaceId, runId),
    queryFn: ({ signal }) => getProfile(runId, signal),
    enabled: Boolean(runId && workspaceId),
    // The review route is also the landing page for a newly queued run. Keep
    // polling until the worker reaches the HITL checkpoint or a terminal state.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return profilingStatuses.has(status || "") || status === "resuming"
        ? 2_500
        : false;
    },
  });
  const pending = useMemo(() => pendingReviewProposals(profile.data), [profile.data]);
  const reviewerName = me?.user.email || (isGuest ? "Phiên dùng thử" : "Tài khoản đăng nhập hiện tại");
  const reviewerRole = "analyst";

  useEffect(() => {
    if (profile.data?.status !== "resuming" || pending.length > 0 || resumeError || resumeWatch) return;
    setResumeWatch(true);
  }, [pending.length, profile.data?.status, resumeError, resumeWatch]);

  useEffect(() => {
    if (!resumeWatch || profile.data?.status !== "resuming" || pending.length > 0) return;
    const timeout = window.setTimeout(() => {
      setResumeWatch(false);
      setResumeError(new ApiError("Worker chưa hoàn tất báo cáo trong thời gian chờ. Hãy kiểm tra worker rồi thử lại.", 408));
    }, resumeWatchTimeoutMs);
    return () => window.clearTimeout(timeout);
  }, [pending.length, profile.data?.status, resumeWatch]);

  useEffect(() => {
    if (!profile.data || profile.data.status !== "completed" || pending.length > 0) return;
    if (resumeError && !profile.data.narrative_report?.trim()) return;
    if (resumeWatch && !profile.data.narrative_report?.trim()) {
      setResumeWatch(false);
      setResumeError(new ApiError("Profile đã hoàn tất nhưng chưa có nội dung báo cáo để mở.", 502));
      return;
    }
    router.replace(profilePreviewPath(runId));
  }, [pending.length, profile.data, resumeError, resumeWatch, router, runId]);

  const mutation = useMutation({
    onMutate: async () => {
      // A pre-review GET must not finish after PATCH and restore stale pending
      // proposals into the shared Profile Run cache.
      await client.cancelQueries({ queryKey: profileQueryKey(workspaceId, runId) });
    },
    mutationFn: () => confirmProposals(runId, {
      resume: true,
      decisions: reviewDecisions(pending, selections),
    }, reviewRequestKey.current || (reviewRequestKey.current = crypto.randomUUID())),
    onError: async (error) => {
      // The DB transaction may have committed even when the PATCH response
      // was lost or a duplicate request raced the first click. Reconcile once
      // with the authoritative profile before showing an error.
      const status = error instanceof ApiError ? error.status : 0;
      if (status !== 0 && status !== 409 && status < 500) return;
      try {
        const latest = await getProfile(runId);
        const stillPending = Object.values(latest.proposals || {}).some((items) =>
          items.some((proposal) => proposal.status === "pending"),
        );
        if (!stillPending && latest.pending_proposals === 0) {
          client.setQueryData(profileQueryKey(workspaceId, runId), latest);
          if (latest.status === "completed" && latest.narrative_report?.trim()) {
            router.replace(profilePreviewPath(runId));
          } else if (latest.status === "resuming") {
            setResumeError(null);
            setResumeWatch(true);
          } else if (latest.status === "completed") {
            setResumeWatch(false);
            setResumeError(new ApiError("Profile đã hoàn tất nhưng chưa có nội dung báo cáo để mở.", 502));
          }
        }
      } catch {
        // Keep the original mutation error visible when reconciliation also
        // fails; the user can retry with the same idempotency key.
      }
    },
    onSuccess: (confirmed) => {
      // This is a backend response, not optimistic UI state. It immediately
      // replaces the fields that decide whether review is still required.
      setResumeError(null);
      client.setQueryData<Profile>(profileQueryKey(workspaceId, runId), (current) => current && ({
        ...current,
        status: confirmed.status,
        pending_proposals: confirmed.pending_proposals,
        ...(confirmed.proposals ? { proposals: confirmed.proposals } : {}),
      }));
      if (confirmed.pending_proposals === 0 && confirmed.status === "resuming") {
        setResumeWatch(true);
      }
      client.invalidateQueries({ queryKey: profilingJobQueryKey(workspaceId, runId) });
      client.invalidateQueries({ queryKey: profileSummaryQueryKey(workspaceId, runId) });
      reviewRequestKey.current = null;
    },
  });

  function chooseDecision(proposal: Proposal, kind: ProposalKind, decision: ProposalDecisionType) {
    setSelections((current) => {
      const existing = current[proposal.id];
      const isEdit = decision === "edit";
      return {
        ...current,
        [proposal.id]: {
          decision,
          ...(isEdit ? { finalType: existing?.finalType || proposal.final_type || proposalValue(kind, proposal) } : {}),
          ...(decision === "edit" || decision === "reject" ? { note: existing?.note } : {}),
        },
      };
    });
  }

  function updateSelection(id: string, patch: Partial<ReviewSelection>) {
    setSelections((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  function setAll(decision: "confirm" | "reject") {
    setSelections(Object.fromEntries(pending.map(({ proposal }) => [proposal.id, { decision }])));
  }

  const completeSelection = reviewSelectionsComplete(pending, selections);

  if (profile.isLoading) return <LoadingBlock label="Đang tải đề xuất cần review…" />;
  if (profile.isError) return <ErrorNotice error={profile.error} retry={() => profile.refetch()} />;
  if (!profile.data) return <EmptyState title="Không có profile" detail="Không thể bắt đầu review vì run không còn tồn tại." />;

  if (profilingStatuses.has(profile.data.status)) return <>
    <PageHeader
      eyebrow={`PROFILING · ${profile.data.run_name || `Phiên bản v${profile.data.version ?? "—"}`}`}
      title="Đang chuẩn bị review"
      description="Profiling đang được xử lý. Khi checkpoint metadata sẵn sàng, trang này sẽ tự hiển thị các proposal cần bạn quyết định."
      action={<Link className="button secondary" href={`/datasets/${encodeURIComponent(profile.data.dataset_id)}/runs`}>Quay lại profile runs</Link>}
    />
    <Notice tone="info"><b>Profiling đang được xử lý.</b><p>Không cần gửi lại yêu cầu. Trang sẽ tự chuyển sang review ngay khi engine hoàn tất checkpoint.</p></Notice>
    <section className="panel review-submit-panel">
      <div className="inline-actions"><StatusBadge status={profile.data.status} /><span className="muted">Profile run: {profile.data.profile_run_id}</span></div>
      <ProgressSteps steps={["Xếp hàng profiling", "Tính metric", "Chuẩn bị review"]} activeStep={profile.data.status === "running" ? 1 : 0} detail="Worker đang xử lý báo cáo. Bạn có thể đóng trang; tiến trình đã được lưu bền vững." />
    </section>
  </>;

  if (profile.data.status === "resuming" && pending.length === 0) return <>
    <PageHeader
      eyebrow={`REVIEW ĐÃ LƯU · ${profile.data.run_name || `Phiên bản v${profile.data.version ?? "—"}`}`}
      title="Đang tiếp tục profiling"
      description="Quyết định metadata đã được lưu. Hệ thống đang hoàn tất báo cáo trước khi mở không gian phân tích."
      action={<Link className="button secondary" href={`/datasets/${encodeURIComponent(profile.data.dataset_id)}/runs`}>Quay lại profile runs</Link>}
    />
    {resumeError && <ErrorNotice error={resumeError} retry={() => { setResumeError(null); setResumeWatch(true); void profile.refetch(); }} />}
    <Notice tone="info"><b>Đang tiếp tục profile sau review.</b><p>Trang sẽ tự chuyển sang không gian phân tích khi báo cáo sẵn sàng.</p></Notice>
    <section className="panel review-submit-panel"><ProgressSteps steps={["Lưu quyết định", "Tiếp tục pipeline", "Hoàn tất báo cáo"]} activeStep={1} detail="Worker đang xử lý checkpoint; bạn không cần gửi lại thao tác." /></section>
  </>;

  if (profile.data.status === "failed") return <>
    <PageHeader
      eyebrow={`PROFILING THẤT BẠI · ${profile.data.run_name || `Phiên bản v${profile.data.version ?? "—"}`}`}
      title="Profiling chưa hoàn tất"
      description="Profile run này không thể hoàn tất. Hãy quay lại danh sách profile run để bắt đầu lại sau khi kiểm tra dataset."
      action={<Link className="button secondary" href={`/datasets/${encodeURIComponent(profile.data.dataset_id)}/runs`}>Quay lại profile runs</Link>}
    />
    <Notice tone="warning"><b>Profile chạy thất bại.</b><p>Hãy kiểm tra dataset và tạo một profile run mới.</p></Notice>
  </>;

  if (profile.data.status === "completed" && pending.length === 0) {
    if (resumeError) return <ErrorNotice error={resumeError} retry={() => { setResumeError(null); setResumeWatch(true); void profile.refetch(); }} />;
    return <LoadingBlock label="Đang mở không gian phân tích…" />;
  }

  return <>
    <PageHeader
      eyebrow={`KIỂM DUYỆT METADATA · ${profile.data.run_name || `Phiên bản v${profile.data.version ?? "—"}`}`}
      title="Xác nhận metadata"
      description="Bạn quyết định metadata nào được dùng cho báo cáo và các bước phân tích sau đó."
      action={<><Link className="button secondary" href={`/chat?profile=${runId}`}>Quay lại không gian Agent</Link><Link className="button secondary" href={`/datasets/${encodeURIComponent(profile.data.dataset_id)}/runs`}>Quay lại profile runs</Link></>}
    />
    {mutation.isError && <ErrorNotice error={mutation.error} />}
    <Notice tone="info"><b>Trạng thái workflow</b><p><StatusBadge status={profile.data.status} /> {profile.data.status === "pending_review" ? "Đang chờ quyết định của Analyst." : profile.data.status === "resuming" ? "Đang tiếp tục checkpoint." : "Kết quả cuối đã được lưu."}</p>{profile.data.answer && <p><b>Câu trả lời:</b> {profile.data.answer}</p>}</Notice>
    <Notice tone="warning"><b>{pending.length} đề xuất đang chờ quyết định.</b><p><b>Xác nhận</b> dùng đề xuất của Agent. <b>Từ chối</b> bỏ đề xuất. <b>Chỉnh sửa</b> chỉ áp dụng cho Semantic type và PII, cần chọn giá trị chính thức cùng lý do.</p></Notice>
    <section className="panel review-context-panel">
      <div className="reviewer-card">
        <span className="reviewer-card-icon" aria-hidden="true">✓</span>
        <div><small>REVIEWER ĐANG THỰC HIỆN</small><b>{reviewerName}</b><span>{toTitle(reviewerRole)} · Tự động ghi vào audit log</span></div>
      </div>
      <div className="review-bulk-actions"><small>THAO TÁC HÀNG LOẠT</small><div className="inline-actions"><button className="button secondary" onClick={() => setAll("confirm")} disabled={mutation.isPending}>Xác nhận tất cả</button><button className="button secondary" onClick={() => setAll("reject")} disabled={mutation.isPending}>Từ chối tất cả</button></div></div>
    </section>
    {pending.length === 0 && profile.data.status === "resuming" ? (
      <section className="panel review-submit-panel">
        <div className="inline-actions"><LoadingButton className="button primary" busy disabled>Đang tạo tóm tắt agent…</LoadingButton><span className="muted">Quyết định đã được lưu. Bạn sẽ được chuyển đến báo cáo khi tóm tắt sẵn sàng.</span></div>
        <ProgressSteps steps={["Lưu quyết định", "Tiếp tục pipeline", "Tạo tóm tắt agent", "Cập nhật profile"]} activeStep={2} detail="Worker đang hoàn tất checkpoint; trang này sẽ tự cập nhật." />
      </section>
    ) : pending.length === 0 ? (
      <EmptyState title="Không còn proposal chờ review" detail="Metadata đã được xử lý. Bạn có thể xem preview báo cáo trước khi mở không gian phân tích." action={<Link href={profilePreviewPath(runId)} className="button primary">Xem preview báo cáo</Link>} />
    ) : (
      <div className="grid" style={{ gap: 18 }}>
        {(["candidate_key", "semantic_type", "pii"] as ProposalKind[]).map((kind) => {
          const items = pending.filter((item) => item.kind === kind);
          if (!items.length) return null;
          const canEdit = kind !== "candidate_key";
          const showColumnHeader = kind === "candidate_key" || kind === "semantic_type";
          return <section className="panel proposal-group" key={kind}>
            <div className="panel-title"><div><h2>{toTitle(kind)}</h2><small>{canEdit ? "Có thể xác nhận, từ chối hoặc chỉnh phân loại." : "Xác nhận hoặc từ chối đây có phải khóa ứng viên."}</small></div><span className="chip">{items.length} chờ review</span></div>
            {showColumnHeader && <div className="proposal-row-header"><span>Agent đề xuất</span><span>Lý do agent đề xuất</span><span>Quyết định của Analyst</span></div>}
            {items.map(({ proposal }) => {
              const selection = selections[proposal.id];
              const editing = selection?.decision === "edit";
              const rejecting = selection?.decision === "reject";
              return <article className="proposal-row pending" key={proposal.id}>
                <div><b>{proposalLabel(proposal)}</b><p>Agent đề xuất: <strong>{proposalValue(kind, proposal)}</strong></p>{proposal.semantic_description && <p>{proposal.semantic_description}</p>}<StatusBadge status={proposal.status} /></div>
                <div><p><span className="confidence">{formatPercent(proposal.confidence_score)}</span> confidence · {proposal.detection_method || "rule-based"}</p><p>{proposal.evidence}</p></div>
                <div className="decision-control">
                  <label className="sr-only" htmlFor={`decision-${proposal.id}`}>Quyết định cho {proposalLabel(proposal)}</label>
                  <select id={`decision-${proposal.id}`} value={selection?.decision || ""} onChange={(event) => chooseDecision(proposal, kind, event.target.value as ProposalDecisionType)}>
                    <option value="" disabled>Chọn quyết định…</option><option value="confirm">Xác nhận đề xuất</option><option value="reject">Từ chối đề xuất</option>{canEdit && <option value="edit">Chỉnh sửa phân loại</option>}
                  </select>
                  {editing && <div className="review-edit-fields">
                    <label htmlFor={`final-${proposal.id}`}>Giá trị chính thức</label>
                    <select id={`final-${proposal.id}`} value={selection?.finalType || ""} onChange={(event) => updateSelection(proposal.id, { finalType: event.target.value })}>
                      {finalValueOptions(kind, proposal).map((value) => <option value={value} key={value}>{value}</option>)}
                    </select>
                    <label htmlFor={`note-${proposal.id}`}>Lý do chỉnh sửa <span aria-hidden="true">*</span></label>
                    <textarea id={`note-${proposal.id}`} value={selection?.note || ""} onChange={(event) => updateSelection(proposal.id, { note: event.target.value })} placeholder="Ví dụ: cột có định dạng ngày giờ nên không phải categorical." maxLength={1000} rows={3} />
                    <small>Bản ghi sẽ lưu đề xuất của Agent, giá trị chính thức, reviewer và thời điểm xử lý.</small>
                  </div>}
                  {rejecting && <div className="review-edit-fields review-note-optional"><label htmlFor={`note-${proposal.id}`}>Lý do từ chối <em>(không bắt buộc)</em></label><textarea id={`note-${proposal.id}`} value={selection?.note || ""} onChange={(event) => updateSelection(proposal.id, { note: event.target.value })} placeholder="Ghi chú để người khác hiểu quyết định của bạn." maxLength={1000} rows={2} /></div>}
                </div>
              </article>;
            })}
          </section>;
        })}
      </div>
    )}
    {pending.length > 0 && <section className="panel review-submit-panel"><div className="inline-actions"><LoadingButton className="button primary" busy={mutation.isPending} disabled={!completeSelection} onClick={() => mutation.mutate()}>{mutation.isPending ? "Đang lưu và tạo tóm tắt agent…" : "Lưu quyết định & tiếp tục pipeline"}</LoadingButton><span className="muted">{Object.keys(selections).length}/{pending.length} đề xuất đã có quyết định rõ ràng.</span></div>{mutation.isPending && <ProgressSteps steps={["Lưu quyết định", "Tiếp tục pipeline", "Tạo tóm tắt agent", "Cập nhật profile"]} activeStep={2} detail="Đang chờ worker hoàn tất checkpoint và lưu tóm tắt agent; bạn không cần gửi lại thao tác." />}</section>}
  </>;
}

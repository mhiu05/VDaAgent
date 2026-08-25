"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { ApiError, confirmProposals, getProfile } from "@/lib/api";
import { formatPercent, toTitle } from "@/lib/format";
import { EmptyState, ErrorNotice, LoadingBlock, LoadingButton, Notice, PageHeader, ProgressSteps, StatusBadge } from "@/components/ui";
import type { Profile, Proposal, ProposalDecisionType, ProposalKind } from "@/lib/types";

type Selection = { decision: ProposalDecisionType; finalType?: string; note?: string };

const SEMANTIC_TYPES = ["identifier", "free-text", "datetime", "categorical", "continuous", "boolean"];
const PII_TYPES = ["email", "phone", "national_id", "address", "full_name", "credit_card", "dob", "ip_address", "unknown"];

function proposalLabel(proposal: Proposal) {
  return proposal.column_name || proposal.columns?.join(", ") || "Đề xuất cấp bộ dữ liệu";
}

function proposalValue(kind: ProposalKind, proposal: Proposal) {
  return kind === "pii" ? proposal.pii_type || "unknown" : proposal.proposed_type || "Candidate key";
}

function finalValueOptions(kind: ProposalKind, proposal: Proposal) {
  const initial = proposal.final_type || proposalValue(kind, proposal);
  const values = kind === "semantic_type" ? SEMANTIC_TYPES : PII_TYPES;
  return [...new Set([initial, ...values])];
}

function profileReturnPath(runId: string) {
  const fallback = `/profiles/${runId}`;
  const value = new URLSearchParams(window.location.search).get("returnTo");
  if (!value) return fallback;

  try {
    const target = new URL(value, window.location.origin);
    const allowedPath = target.pathname === fallback || target.pathname === "/chat";
    return target.origin === window.location.origin && allowedPath
      ? `${target.pathname}${target.search}${target.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export default function ReviewPage() {
  const { runId } = useParams<{ runId: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const { me, isGuest } = useAuth();
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const reviewRequestKey = useRef<string | null>(null);
  const profile = useQuery({ queryKey: ["profile", runId], queryFn: ({ signal }) => getProfile(runId, signal), enabled: Boolean(runId) });
  const pending = useMemo(
    () => Object.entries(profile.data?.proposals || {}).flatMap(([kind, proposals]) => proposals
      .filter((proposal) => proposal.status === "pending")
      .map((proposal) => ({ proposal, kind: kind as ProposalKind }))),
    [profile.data],
  );
  const reviewerName = me?.user.email || (isGuest ? "Phiên dùng thử" : "Tài khoản đăng nhập hiện tại");
  const reviewerRole = "analyst";
  const mutation = useMutation({
    onMutate: async () => {
      // A pre-review GET must not finish after PATCH and restore stale pending
      // proposals into the shared Profile Run cache.
      await client.cancelQueries({ queryKey: ["profile", runId] });
    },
    mutationFn: () => confirmProposals(runId, {
      resume: true,
      decisions: pending.map(({ proposal, kind }) => {
        const selection = selections[proposal.id]!;
        return {
          kind,
          proposal_id: proposal.id,
          decision: selection.decision,
          ...(selection.decision === "edit" && selection.finalType?.trim() ? { final_type: selection.finalType.trim() } : {}),
          ...(selection.note?.trim() ? { note: selection.note.trim() } : {}),
        };
      }),
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
          client.setQueryData(["profile", runId], latest);
          router.replace(profileReturnPath(runId));
        }
      } catch {
        // Keep the original mutation error visible when reconciliation also
        // fails; the user can retry with the same idempotency key.
      }
    },
    onSuccess: async (confirmed) => {
      // This is a backend response, not optimistic UI state. It immediately
      // replaces the fields that decide whether review is still required.
      client.setQueryData<Profile>(["profile", runId], (current) => current && ({
        ...current,
        status: confirmed.status,
        pending_proposals: confirmed.pending_proposals,
        ...(confirmed.proposals ? { proposals: confirmed.proposals } : {}),
      }));
      // The PATCH response contains the same post-transaction proposal
      // snapshot used to calculate pending_proposals. Do not refetch profile
      // here: a stale in-flight GET can otherwise overwrite the saved decision
      // while the durable resume job is still moving from queued to completed.
      client.invalidateQueries({ queryKey: ["profiling-job", runId] });
      reviewRequestKey.current = null;
      router.replace(profileReturnPath(runId));
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

  function updateSelection(id: string, patch: Partial<Selection>) {
    setSelections((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  function setAll(decision: "confirm" | "reject") {
    setSelections(Object.fromEntries(pending.map(({ proposal }) => [proposal.id, { decision }])));
  }

  const completeSelection = pending.length > 0
    && pending.every(({ proposal }) => {
      const selection = selections[proposal.id];
      const finalType = selection?.finalType?.trim() || "";
      const reviewNote = selection?.note?.trim() || "";
      return Boolean(selection?.decision)
        && (selection?.decision !== "edit" || Boolean(finalType && reviewNote.length >= 3));
    });

  if (profile.isLoading) return <LoadingBlock label="Đang tải đề xuất cần review…" />;
  if (profile.isError) return <ErrorNotice error={profile.error} retry={() => profile.refetch()} />;
  if (!profile.data) return <EmptyState title="Không có profile" detail="Không thể bắt đầu review vì run không còn tồn tại." />;

  return <>
    <PageHeader
      eyebrow={`KIỂM DUYỆT METADATA · ${profile.data.run_name || `Phiên bản v${profile.data.version ?? "—"}`}`}
      title="Xác nhận metadata"
      description="Bạn quyết định metadata nào được dùng cho báo cáo và các bước phân tích sau đó."
      action={<><Link className="button secondary" href={`/chat?profile=${runId}`}>Quay lại không gian Agent</Link><Link className="button secondary" href={`/profiles/${runId}`}>Quay lại báo cáo</Link></>}
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
    {pending.length === 0 ? (
      <EmptyState title="Không còn proposal chờ review" detail="Bạn có thể quay lại báo cáo profile để xem metadata đã được xử lý." action={<Link href={`/profiles/${runId}`} className="button primary">Xem báo cáo</Link>} />
    ) : (
      <div className="grid" style={{ gap: 18 }}>
        {(["candidate_key", "semantic_type", "pii"] as ProposalKind[]).map((kind) => {
          const items = pending.filter((item) => item.kind === kind);
          if (!items.length) return null;
          const canEdit = kind !== "candidate_key";
          return <section className="panel proposal-group" key={kind}>
            <div className="panel-title"><div><h2>{toTitle(kind)}</h2><small>{canEdit ? "Có thể xác nhận, từ chối hoặc chỉnh phân loại." : "Xác nhận hoặc từ chối đây có phải khóa ứng viên."}</small></div><span className="chip">{items.length} chờ review</span></div>
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
    {pending.length > 0 && <section className="panel review-submit-panel"><div className="inline-actions"><LoadingButton className="button primary" busy={mutation.isPending} disabled={!completeSelection} onClick={() => mutation.mutate()}>{mutation.isPending ? "Đang lưu và tiếp tục pipeline…" : "Lưu quyết định & tiếp tục pipeline"}</LoadingButton><span className="muted">{Object.keys(selections).length}/{pending.length} đề xuất đã có quyết định rõ ràng.</span></div>{mutation.isPending && <ProgressSteps steps={["Lưu quyết định", "Tiếp tục pipeline", "Cập nhật profile"]} activeStep={1} detail="Backend đang tiếp tục checkpoint; bạn không cần gửi lại thao tác." />}</section>}
  </>;
}

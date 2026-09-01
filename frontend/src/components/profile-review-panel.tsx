"use client";

import { useMemo, useRef, useState } from "react";
import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, confirmProposals, getProfile } from "@/lib/api";
import { profileQueryKey, profileSummaryQueryKey, profilingJobQueryKey } from "@/lib/profile-query-keys";
import { finalValueOptions, pendingReviewProposals, proposalLabel, proposalValue, reviewDecisions, reviewSelectionsComplete, type ReviewSelection } from "@/lib/profile-review";
import { formatPercent, toTitle } from "@/lib/format";
import { ErrorNotice, LoadingBlock, LoadingButton, Notice, StatusBadge } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import type { Profile, Proposal, ProposalDecisionType, ProposalKind } from "@/lib/types";

type Props = { runId: string; onClose: () => void };

export function ProfileReviewPanel({ runId, onClose }: Props) {
  const client = useQueryClient();
  const { workspaceId } = useAuth();
  const [selections, setSelections] = useState<Record<string, ReviewSelection>>({});
  const idempotencyKey = useRef<string | null>(null);
  const profile = useQuery({ queryKey: profileQueryKey(workspaceId, runId), queryFn: ({ signal }) => getProfile(runId, signal), enabled: Boolean(runId && workspaceId) });
  const pending = useMemo(() => pendingReviewProposals(profile.data), [profile.data]);
  const mutation = useMutation({
    onMutate: async () => {
      // A stale profile GET must not overwrite the confirmed server snapshot.
      await client.cancelQueries({ queryKey: profileQueryKey(workspaceId, runId) });
    },
    mutationFn: () => confirmProposals(runId, {
      resume: true,
      decisions: reviewDecisions(pending, selections),
    }, idempotencyKey.current || (idempotencyKey.current = crypto.randomUUID())),
    onSuccess: (confirmed) => {
      client.setQueryData<Profile>(profileQueryKey(workspaceId, runId), (current) => current && ({ ...current, status: confirmed.status, pending_proposals: confirmed.pending_proposals, ...(confirmed.proposals ? { proposals: confirmed.proposals } : {}) }));
      client.invalidateQueries({ queryKey: profileSummaryQueryKey(workspaceId, runId) });
      client.invalidateQueries({ queryKey: profilingJobQueryKey(workspaceId, runId) });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        client.invalidateQueries({ queryKey: profileQueryKey(workspaceId, runId) });
        client.invalidateQueries({ queryKey: profileSummaryQueryKey(workspaceId, runId) });
      }
    },
  });

  const choose = (proposal: Proposal, kind: ProposalKind, decision: ProposalDecisionType) => setSelections((current) => ({ ...current, [proposal.id]: { decision, ...(decision === "edit" ? { finalType: current[proposal.id]?.finalType || proposal.final_type || proposalValue(kind, proposal) } : {}), ...(decision !== "confirm" ? { note: current[proposal.id]?.note } : {}) } }));
  const complete = reviewSelectionsComplete(pending, selections);
  const submit = () => {
    if (!complete || mutation.isPending) return;
    mutation.mutate();
  };

  if (profile.isLoading) return <LoadingBlock label="Đang tải đề xuất cần review…" />;
  if (profile.isError) return <ErrorNotice error={profile.error} retry={() => profile.refetch()} />;
  if (!profile.data) return <Notice tone="warning">Không thể tải review cho profile run này.</Notice>;
  if (!pending.length && profile.data.status === "resuming") return <Notice tone="info"><b>Đã lưu quyết định.</b><p>Profile đang tiếp tục; không gian phân tích sẽ mở khi báo cáo sẵn sàng.</p></Notice>;
  if (!pending.length) return <Notice tone="info">Không còn proposal chờ review.</Notice>;

  return <section className="panel inline-review-panel" aria-label="Review đề xuất metadata">
    <div className="panel-title"><div><p className="eyebrow">INLINE HITL REVIEW</p><h2>Xác nhận metadata</h2><small>{pending.length} đề xuất cần Analyst quyết định trước khi tiếp tục.</small></div><button type="button" className="button secondary" onClick={onClose} disabled={mutation.isPending}>Đóng</button></div>
    {mutation.isError && profile.data.status === "pending_review" && <ErrorNotice error={mutation.error instanceof ApiError ? mutation.error : new Error("Không thể lưu quyết định review.")} />}
    {(["candidate_key", "semantic_type", "pii"] as ProposalKind[]).map((kind) => {
      const items = pending.filter((item) => item.kind === kind); if (!items.length) return null;
      const canEdit = kind !== "candidate_key";
      return <div className="proposal-group" key={kind}><div className="panel-title"><h3>{toTitle(kind)}</h3><span className="chip">{items.length} chờ review</span></div>{items.map(({ proposal }) => {
        const selection = selections[proposal.id]; const editing = selection?.decision === "edit";
        const options = finalValueOptions(kind, proposal);
        return <article className="proposal-row pending" key={proposal.id}><div><b>{proposalLabel(proposal)}</b><p>Agent đề xuất: <strong>{proposalValue(kind, proposal)}</strong></p><StatusBadge status={proposal.status} /></div><div><p><span className="confidence">{formatPercent(proposal.confidence_score)}</span> confidence · {proposal.detection_method || "rule-based"}</p><p>{proposal.evidence}</p></div><div className="decision-control"><label htmlFor={`inline-decision-${proposal.id}`}>Quyết định</label><select id={`inline-decision-${proposal.id}`} value={selection?.decision || ""} onChange={(event) => choose(proposal, kind, event.target.value as ProposalDecisionType)}><option value="" disabled>Chọn quyết định…</option><option value="confirm">Xác nhận đề xuất</option><option value="reject">Từ chối đề xuất</option>{canEdit && <option value="edit">Chỉnh sửa phân loại</option>}</select>{editing && <><label htmlFor={`inline-final-${proposal.id}`}>Giá trị chính thức</label><select id={`inline-final-${proposal.id}`} value={selection?.finalType || ""} onChange={(event) => setSelections((current) => ({ ...current, [proposal.id]: { ...current[proposal.id], finalType: event.target.value } }))}>{options.map((option) => <option value={option} key={option}>{option}</option>)}</select><label htmlFor={`inline-note-${proposal.id}`}>Lý do chỉnh sửa (bắt buộc)</label><textarea id={`inline-note-${proposal.id}`} value={selection?.note || ""} onChange={(event) => setSelections((current) => ({ ...current, [proposal.id]: { ...current[proposal.id], note: event.target.value } }))} minLength={3} maxLength={1000} rows={2} /></>}</div></article>;
      })}</div>;
    })}
    <div className="inline-actions"><LoadingButton className="button primary" busy={mutation.isPending} disabled={!complete || mutation.isPending} onClick={submit}>{mutation.isPending ? "Đang lưu…" : "Lưu quyết định & tiếp tục"}</LoadingButton><span className="muted">Mỗi proposal phải có quyết định rõ ràng.</span></div>
  </section>;
}

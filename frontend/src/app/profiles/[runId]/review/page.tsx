"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { confirmProposals, getProfile } from "@/lib/api";
import { formatPercent, toTitle } from "@/lib/format";
import { EmptyState, ErrorNotice, LoadingBlock, Notice, PageHeader, StatusBadge } from "@/components/ui";
import type { Proposal, ProposalDecisionType, ProposalKind } from "@/lib/types";

type Selection = { decision: ProposalDecisionType; finalType?: string; note?: string };

function proposalLabel(proposal: Proposal) {
  return proposal.column_name || proposal.columns?.join(", ") || "Dataset-level proposal";
}

export default function ReviewPage() {
  const { runId } = useParams<{ runId: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const [analyst, setAnalyst] = useState("analyst@local");
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const profile = useQuery({ queryKey: ["profile", runId], queryFn: ({ signal }) => getProfile(runId, signal), enabled: Boolean(runId) });
  const pending = useMemo(() => Object.entries(profile.data?.proposals || {}).flatMap(([kind, proposals]) => proposals.filter((proposal) => proposal.status === "pending").map((proposal) => ({ proposal, kind: kind as ProposalKind }))), [profile.data]);
  const mutation = useMutation({
    mutationFn: () => confirmProposals(runId, { resume: true, action: "confirm", decisions: pending.map(({ proposal, kind }) => { const selection = selections[proposal.id]!; return { kind, proposal_id: proposal.id, decision: selection.decision, ...(selection.finalType ? { final_type: selection.finalType } : {}), ...(selection.note ? { note: selection.note } : {}) }; }) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["profile", runId] });
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      router.push(returnTo || `/profiles/${runId}`);
    },
  });
  function setSelection(id: string, patch: Partial<Selection>) {
    setSelections((current) => {
      const existing = current[id];
      return { ...current, [id]: { ...existing, ...patch, decision: patch.decision ?? existing?.decision ?? "reject" } };
    });
  }
  function setAll(decision: ProposalDecisionType) { setSelections(Object.fromEntries(pending.map(({ proposal }) => [proposal.id, { decision }]))); }
  if (profile.isLoading) return <LoadingBlock label="Đang tải evidence review…" />;
  if (profile.isError) return <ErrorNotice error={profile.error} retry={() => profile.refetch()} />;
  if (!profile.data) return <EmptyState title="Không có profile" detail="Không thể bắt đầu review vì run không còn tồn tại." />;
  return <>
    <PageHeader eyebrow={`HITL review · ${runId}`} title="Xác nhận metadata" description="Mỗi quyết định được ghi audit. Candidate key và PII không bao giờ được Agent tự xác nhận." action={<><Link className="button secondary" href={`/chat?profile=${runId}`}>Quay lại không gian Agent</Link><Link className="button secondary" href={`/profiles/${runId}`}>Quay lại báo cáo</Link></>} />
    {mutation.isError && <ErrorNotice error={mutation.error} />}
    <Notice tone="info"><b>Trạng thái workflow</b><p><StatusBadge status={profile.data.status} /> {profile.data.status === "pending_review" ? "Đang chờ quyết định của Analyst." : profile.data.status === "resuming" ? "Đang tiếp tục checkpoint." : "Kết quả cuối đã được lưu."}</p>{profile.data.answer && <p><b>Câu trả lời:</b> {profile.data.answer}</p>}</Notice>
    <Notice tone="warning"><b>{pending.length} đề xuất đang chờ quyết định.</b><p>Quyết định “edit” cần semantic type/final type. Nếu không chọn, proposal sẽ được reject có chủ đích.</p></Notice>
    <section className="panel" style={{ marginBottom: 18 }}><div className="form-grid"><div className="field"><label htmlFor="analyst">Danh tính reviewer</label><input id="analyst" value={analyst} onChange={(event) => setAnalyst(event.target.value)} maxLength={255} /><small className="hint">Sẽ được backend ghi vào audit log.</small></div><div className="field"><label>Thao tác hàng loạt</label><div className="inline-actions"><button className="button secondary" onClick={() => setAll("confirm")}>Xác nhận tất cả</button><button className="button secondary" onClick={() => setAll("reject")}>Từ chối tất cả</button></div></div></div></section>
      {pending.length === 0 ? (
        <EmptyState title="Không còn proposal chờ review" detail="Bạn có thể quay lại báo cáo profile để xem metadata đã được xử lý." action={<Link href={`/profiles/${runId}`} className="button primary">Xem báo cáo</Link>} />
      ) : (
        <div className="grid" style={{ gap: 18 }}>
          {(["candidate_key", "semantic_type", "pii"] as ProposalKind[]).map((kind) => {
            const items = pending.filter((item) => item.kind === kind);
            if (!items.length) return null;
            return (
              <section className="panel proposal-group" key={kind}>
                <div className="panel-title"><h2>{toTitle(kind)}</h2><span className="chip">{items.length} pending</span></div>
                {items.map(({ proposal }) => {
                  const selection = selections[proposal.id];
                  return (
                    <article className="proposal-row pending" key={proposal.id}>
                      <div><b>{proposalLabel(proposal)}</b><p>{proposal.proposed_type || proposal.pii_type || "Candidate"}</p>{proposal.semantic_description && <p>{proposal.semantic_description}</p>}<StatusBadge status={proposal.status} /></div>
                      <div><p><span className="confidence">{formatPercent(proposal.confidence_score)}</span> confidence · {proposal.detection_method || "rule-based"}</p><p>{proposal.evidence}</p></div>
                      <div className="decision-control">
                        <select aria-label={`Quyết định cho ${proposalLabel(proposal)}`} value={selection?.decision || ""} onChange={(event) => setSelection(proposal.id, { decision: event.target.value as ProposalDecisionType })}>
                          <option value="" disabled>Chọn quyết định…</option><option value="confirm">Xác nhận</option><option value="reject">Từ chối</option><option value="edit">Chỉnh sửa</option>
                        </select>
                        {selection?.decision === "edit" && <input aria-label={`Kiểu cuối cùng cho ${proposalLabel(proposal)}`} placeholder="Kiểu cuối cùng" value={selection.finalType || ""} onChange={(event) => setSelection(proposal.id, { finalType: event.target.value })} />}
                      </div>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    {pending.length > 0 && <section className="panel" style={{ marginTop: 18 }}><div className="inline-actions"><button className="button primary" disabled={!analyst.trim() || mutation.isPending || Object.keys(selections).length !== pending.length || pending.some(({ proposal }) => selections[proposal.id]?.decision === "edit" && !selections[proposal.id]?.finalType?.trim())} onClick={() => mutation.mutate()}>{mutation.isPending ? "Đang lưu và resume…" : "Lưu quyết định & resume pipeline"}</button><span className="muted">{Object.keys(selections).length}/{pending.length} đã chọn; cần quyết định rõ từng đề xuất.</span></div></section>}
  </>;
}

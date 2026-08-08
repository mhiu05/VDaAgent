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
  const [testType, setTestType] = useState("shapiro_wilk");
  const [testColumn, setTestColumn] = useState("");
  const profile = useQuery({ queryKey: ["profile", runId], queryFn: ({ signal }) => getProfile(runId, signal), enabled: Boolean(runId) });
  const pending = useMemo(() => Object.entries(profile.data?.proposals || {}).flatMap(([kind, proposals]) => proposals.filter((proposal) => proposal.status === "pending").map((proposal) => ({ proposal, kind: kind as ProposalKind }))), [profile.data]);
  const mutation = useMutation({
    mutationFn: () => confirmProposals(runId, { confirmed_by: analyst.trim(), resume: true, action: "confirm", decisions: pending.map(({ proposal, kind }) => { const selection = selections[proposal.id]!; return { kind, proposal_id: proposal.id, decision: selection.decision, ...(selection.finalType ? { final_type: selection.finalType } : {}), ...(selection.note ? { note: selection.note } : {}) }; }) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["profile", runId] });
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      router.push(returnTo || `/profiles/${runId}`);
    },
  });
  const testMutation = useMutation({
    mutationFn: () => confirmProposals(runId, { confirmed_by: analyst.trim() || "analyst@local", resume: true, action: "request_test", decisions: [], test_requests: [{ test_type: testType, columns: [testColumn] }] }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["profile", runId] }); },
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
  const columns = Object.keys(profile.data.column_stats);
  const selectedTestColumn = testColumn || columns[0] || "";
  return <>
    <PageHeader eyebrow={`HITL review · ${runId}`} title="Xác nhận metadata" description="Mỗi quyết định được ghi audit. Candidate key và PII không bao giờ được agent tự xác nhận." action={<><Link className="button secondary" href={`/chat?profile=${runId}`}>Quay lại Agent workspace</Link><Link className="button secondary" href={`/profiles/${runId}`}>Quay lại report</Link></>} />
    {mutation.isError && <ErrorNotice error={mutation.error} />}
    {testMutation.isError && <ErrorNotice error={testMutation.error} />}
    <Notice tone="info"><b>Workflow status</b><p><StatusBadge status={profile.data.status} /> {profile.data.status === "pending_review" ? "Đang chờ quyết định Analyst." : profile.data.status === "resuming" ? "Đang tiếp tục checkpoint." : "Kết quả cuối đã được lưu."}</p>{profile.data.answer && <p><b>Answer:</b> {profile.data.answer}</p>}</Notice>
    <Notice tone="warning"><b>{pending.length} đề xuất đang chờ quyết định.</b><p>Quyết định “edit” cần semantic type/final type. Nếu không chọn, proposal sẽ được reject có chủ đích.</p></Notice>
    <section className="panel" style={{ marginBottom: 18 }}><div className="form-grid"><div className="field"><label htmlFor="analyst">Reviewer identity</label><input id="analyst" value={analyst} onChange={(event) => setAnalyst(event.target.value)} maxLength={255} /><small className="hint">Sẽ được backend ghi vào audit log.</small></div><div className="field"><label>Bulk action</label><div className="inline-actions"><button className="button secondary" onClick={() => setAll("confirm")}>Confirm tất cả</button><button className="button secondary" onClick={() => setAll("reject")}>Reject tất cả</button></div></div></div></section>
      {pending.length === 0 ? (
        <EmptyState title="Không còn proposal chờ review" detail="Bạn có thể quay lại profile report để xem metadata đã được xử lý." action={<Link href={`/profiles/${runId}`} className="button primary">Xem report</Link>} />
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
                          <option value="" disabled>Chọn quyết định…</option><option value="confirm">Confirm</option><option value="reject">Reject</option><option value="edit">Edit</option>
                        </select>
                        {selection?.decision === "edit" && <input aria-label={`Final type cho ${proposalLabel(proposal)}`} placeholder="Final type" value={selection.finalType || ""} onChange={(event) => setSelection(proposal.id, { finalType: event.target.value })} />}
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
    <section className="panel" style={{ marginTop: 18 }}><div className="panel-title"><h2>Deep analysis</h2><span className="chip">request_test</span></div><div className="inline-actions"><select value={testType} onChange={(event) => setTestType(event.target.value)}><option value="shapiro_wilk">Shapiro-Wilk</option><option value="pearson">Pearson</option><option value="chi_square">Chi-square</option></select><select value={selectedTestColumn} onChange={(event) => setTestColumn(event.target.value)}>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select><button className="button secondary" disabled={!selectedTestColumn || testMutation.isPending || profile.data.status !== "pending_review"} onClick={() => testMutation.mutate()}>{testMutation.isPending ? "Đang chạy…" : "Request test & pause lại"}</button></div>{(profile.data.test_results || []).length > 0 && <div className="table-wrap" style={{ marginTop: 14 }}><table><thead><tr><th>Test</th><th>Columns</th><th>Conclusion</th><th>p-value</th></tr></thead><tbody>{(profile.data.test_results || []).map((result, index) => <tr key={`${result.test_type}-${index}`}><td>{result.test_type}</td><td>{result.target_columns.join(", ")}</td><td>{result.conclusion}</td><td>{result.p_value ?? "—"}</td></tr>)}</tbody></table></div>}</section>
  </>;
}

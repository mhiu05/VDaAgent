import type { Profile, Proposal, ProposalDecisionType, ProposalKind } from "@/lib/types";

export type ReviewSelection = { decision: ProposalDecisionType; finalType?: string; note?: string };
export type PendingReviewProposal = { proposal: Proposal; kind: ProposalKind };

const SEMANTIC_TYPES = ["identifier", "free-text", "datetime", "categorical", "continuous", "boolean"];
const PII_TYPES = ["email", "phone", "national_id", "address", "full_name", "credit_card", "dob", "ip_address", "unknown"];

export function pendingReviewProposals(profile?: Pick<Profile, "proposals"> | null): PendingReviewProposal[] {
  return Object.entries(profile?.proposals || {}).flatMap(([kind, proposals]) => proposals
    .filter((proposal) => proposal.status === "pending")
    .map((proposal) => ({ proposal, kind: kind as ProposalKind })));
}

export function proposalLabel(proposal: Proposal) {
  return proposal.column_name || proposal.columns?.join(", ") || "Đề xuất cấp bộ dữ liệu";
}

export function proposalValue(kind: ProposalKind, proposal: Proposal) {
  return kind === "pii" ? proposal.pii_type || "unknown" : proposal.proposed_type || "Candidate key";
}

export function finalValueOptions(kind: ProposalKind, proposal: Proposal) {
  const initial = proposal.final_type || proposalValue(kind, proposal);
  const values = kind === "semantic_type" ? SEMANTIC_TYPES : PII_TYPES;
  return [...new Set([initial, ...values])];
}

export function reviewDecisions(pending: PendingReviewProposal[], selections: Record<string, ReviewSelection>) {
  return pending.map(({ proposal, kind }) => {
    const selection = selections[proposal.id]!;
    return {
      kind,
      proposal_id: proposal.id,
      decision: selection.decision,
      ...(selection.decision === "edit" && selection.finalType?.trim() ? { final_type: selection.finalType.trim() } : {}),
      ...(selection.note?.trim() ? { note: selection.note.trim() } : {}),
    };
  });
}

export function reviewSelectionsComplete(pending: PendingReviewProposal[], selections: Record<string, ReviewSelection>) {
  return pending.length > 0 && pending.every(({ proposal }) => {
    const selection = selections[proposal.id];
    const finalType = selection?.finalType?.trim() || "";
    const reviewNote = selection?.note?.trim() || "";
    return Boolean(selection?.decision)
      && (selection?.decision !== "edit" || Boolean(finalType && reviewNote.length >= 3));
  });
}

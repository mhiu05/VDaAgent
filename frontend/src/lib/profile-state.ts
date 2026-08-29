import type { ProfileSummary } from "@/lib/types";

export type CommandCenterState = "queued" | "profiling" | "review_required" | "resuming" | "ready" | "failed";

const stateOrder: Record<Exclude<CommandCenterState, "failed">, number> = {
  queued: 0,
  profiling: 1,
  review_required: 2,
  resuming: 3,
  ready: 4,
};

/** The single progress mapping used by the Command Center shell. */
export function deriveCommandCenterState(summary?: ProfileSummary | null): CommandCenterState {
  if (!summary) return "queued";
  if (summary.status === "failed" || summary.job_status === "failed") return "failed";
  // The persisted run status is authoritative for the HITL boundary. Proposal
  // rows can be visible briefly before the worker commits `pending_review`;
  // opening review during that window would produce a guaranteed 409.
  if (summary.status === "pending_review") return "review_required";
  if (summary.status === "resuming") return "resuming";
  // A job can succeed at the review checkpoint. Only a completed profile run
  // unlocks Command Center actions that require the final backend result.
  if (summary.status === "completed") return "ready";
  if (summary.job_status === "running" || ["created", "running"].includes(summary.status)) return "profiling";
  return "queued";
}

/**
 * Keep a late polling response from moving the Command Center backwards after
 * SSE has already delivered a persisted milestone. Failed remains dominant,
 * matching the canonical state mapper's job-status safety rule.
 */
export function newestProfileSummary(current: ProfileSummary | undefined, incoming: ProfileSummary): ProfileSummary {
  if (!current) return incoming;
  const currentState = deriveCommandCenterState(current);
  const incomingState = deriveCommandCenterState(incoming);
  if (incomingState === "failed") return incoming;
  if (currentState === "failed") return current;
  return stateOrder[incomingState] < stateOrder[currentState] ? current : incoming;
}

export const commandCenterStateLabel: Record<CommandCenterState, string> = {
  queued: "Queued",
  profiling: "Profiling",
  review_required: "Review required",
  resuming: "Resuming",
  ready: "Ready",
  failed: "Failed",
};

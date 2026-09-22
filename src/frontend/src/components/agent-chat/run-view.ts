import type { AnalysisRun, Conversation } from '@vda/contracts';

/**
 * An externally selected run must stay non-mutating until its durable metadata
 * has loaded. That fail-closed state also prevents a scheduled conversation
 * from briefly exposing interactive controls during navigation.
 */
export function isReadOnlyRunView(
  externalRunId: string | null | undefined,
  run: Pick<AnalysisRun, 'run_id' | 'entrypoint'> | null,
  conversationKind: Conversation['kind'] | undefined,
): boolean {
  return (
    Boolean(externalRunId && (!run || run.run_id !== externalRunId)) ||
    run?.entrypoint === 'scheduled' ||
    conversationKind === 'scheduled'
  );
}

/** Keep unresolved external runs in AgentChat; legacy UI is opt-in by version. */
export function shouldRenderAgentChat(
  runId: string | null,
  workflowVersion: AnalysisRun['workflow_version'] | undefined,
): boolean {
  return !runId || workflowVersion !== 'legacy-v1';
}

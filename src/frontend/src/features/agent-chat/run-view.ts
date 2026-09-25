import type { AnalysisRun, Conversation } from '@vda/contracts';

/**
 * An externally selected run must stay non-mutating until its durable metadata
 * has loaded. That fail-closed state also prevents a scheduled conversation
 * from briefly exposing interactive controls during navigation.
 */
export function isReadOnlyRunView(
  externalRunId: string | null | undefined,
  run:
    | (Pick<AnalysisRun, 'run_id' | 'entrypoint'> & Partial<Pick<AnalysisRun, 'workflow_version'>>)
    | null,
  conversationKind: Conversation['kind'] | undefined,
): boolean {
  return (
    Boolean(externalRunId && (!run || run.run_id !== externalRunId)) ||
    (run && (run.workflow_version ?? 'legacy-v1') === 'legacy-v1') ||
    run?.entrypoint === 'scheduled' ||
    conversationKind === 'scheduled'
  );
}

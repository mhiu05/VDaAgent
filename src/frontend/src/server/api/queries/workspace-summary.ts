import type { Repository } from '@vda/db';

export async function workspaceSummary(repo: Repository, userId: string, orgId: string) {
  const [runs, reports, imports, conversations, definitions] = await Promise.all([
    repo.listRuns(userId, orgId),
    repo.listReports(userId, orgId),
    repo.listImports(userId, orgId),
    repo.listConversations(userId, orgId, { limit: 6, cursor: null }),
    repo.listDefinitions(userId, orgId),
  ]);
  const runCounts = { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
  for (const run of runs) runCounts[run.status]++;
  return {
    org_id: orgId,
    recent_runs: runs.slice(0, 6),
    run_counts: runCounts,
    recent_reports: reports.slice(0, 6),
    recent_imports: [...imports]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, 6),
    recent_conversations: conversations.conversations,
    active_schedules: definitions
      .filter((definition) => definition.enabled)
      .sort((left, right) => left.next_run_at.localeCompare(right.next_run_at))
      .slice(0, 6),
  };
}

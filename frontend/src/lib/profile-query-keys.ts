export function profileQueryKey(workspaceId: string | null | undefined, runId: string) {
  return ["profile", workspaceId ?? "no-workspace", runId] as const;
}

export function profileSummaryQueryKey(workspaceId: string | null | undefined, runId: string) {
  return ["profile-summary", workspaceId ?? "no-workspace", runId] as const;
}

export function profilingJobQueryKey(workspaceId: string | null | undefined, jobId: string) {
  return ["profiling-job", workspaceId ?? "no-workspace", jobId] as const;
}

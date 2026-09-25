import { RepositoryError, type AgentJobLease, type Repository } from '@vda/db';

const publicCodes = new Set([
  'UNSUPPORTED_DURABLE_REQUEST','SCOPE_NOT_FOUND','DATA_ARTIFACT_MISSING',
  'DATA_ARTIFACT_INVALID','DATA_ARTIFACT_LINEAGE_MISMATCH',
  'DATA_ARTIFACT_VALIDATION_REQUIRED','DATA_STAGE_NOT_SUCCEEDED',
  'DATA_INVOCATION_MISMATCH','DURABLE_RUN_MISMATCH',
]);

/** One bounded phase per claim. Waiting never occupies a worker or provider call. */
export async function dispatchAgentTurn(
  repository: Repository,
  lease: AgentJobLease,
  dependencies: {
    log?: (message: string) => void;
    error?: (message: string) => void;
    startHeartbeat?: typeof setInterval;
    stopHeartbeat?: typeof clearInterval;
  } = {},
) {
  const {
    log = console.log, error = console.error,
    startHeartbeat = setInterval, stopHeartbeat = clearInterval,
  } = dependencies;
  const heartbeat = startHeartbeat(() => {
    void repository.renewAgentTurnLease(lease).catch(() => {
      // The next fenced transition rejects a stale worker.
    });
  },10000);
  try {
    if (lease.job.run_id) await repository.resumeAgentAnalysis(lease);
    else await repository.startAgentAnalysis(lease);
    log(JSON.stringify({event:'agent_turn_phase_completed',job_id:lease.job.job_id}));
  } catch (cause) {
    const code = cause instanceof RepositoryError && publicCodes.has(cause.code)
      ? cause.code === 'SCOPE_NOT_FOUND' ? 'UNSUPPORTED_SCOPE' : cause.code
      : 'AGENT_EXECUTION_FAILED';
    error(JSON.stringify({event:'agent_turn_phase_failed',job_id:lease.job.job_id,code}));
    try { await repository.failAgentTurnJob(lease,code); }
    catch { /* Cancelled, revoked, or reclaimed: the newer owner resolves the job. */ }
  } finally {
    stopHeartbeat(heartbeat);
  }
}

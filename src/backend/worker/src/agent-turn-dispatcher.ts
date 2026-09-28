import { RepositoryError, type AgentJobLease, type Repository } from '@vda/db';
import { AgentRuntime, isApprovedDurableAnalysisTurn } from '@vda/agents';
import { errorDiagnostics } from './error-diagnostics';

const publicCodes = new Set([
  'UNSUPPORTED_DURABLE_REQUEST','SCOPE_NOT_FOUND','DATA_ARTIFACT_MISSING',
  'DATA_ARTIFACT_INVALID','DATA_ARTIFACT_LINEAGE_MISMATCH',
  'DATA_ARTIFACT_VALIDATION_REQUIRED','DATA_STAGE_NOT_SUCCEEDED',
  'DATA_INVOCATION_MISMATCH','DURABLE_RUN_MISMATCH',
]);

function safeRepositoryCode(cause: unknown): string | null {
  return cause instanceof RepositoryError && /^[A-Z0-9_]{1,100}$/.test(cause.code)
    ? cause.code
    : null;
}

/** One bounded phase per claim. Waiting never occupies a worker or provider call. */
export async function dispatchAgentTurn(
  repository: Repository,
  lease: AgentJobLease,
  dependencies: {
    log?: (message: string) => void;
    error?: (message: string) => void;
    startHeartbeat?: typeof setInterval;
    stopHeartbeat?: typeof clearInterval;
    runtime?: Pick<AgentRuntime, 'resumeDurableTurn'>;
  } = {},
) {
  const {
    log = console.log, error = console.error,
    startHeartbeat = setInterval, stopHeartbeat = clearInterval,
  } = dependencies;
  const cancellation = new AbortController();
  let active = true;
  const heartbeat = startHeartbeat(() => {
    void repository.renewAgentTurnLease(lease).catch((cause) => {
      if (!active || cancellation.signal.aborted) return;
      cancellation.abort();
      error(JSON.stringify({
        event: 'agent_turn_lease_renewal_failed',
        job_id: lease.job.job_id,
        ...errorDiagnostics(cause),
      }));
    });
  },10000);
  try {
    if (lease.job.run_id) await repository.resumeAgentAnalysis(lease);
    else {
      const execution = await repository.getAgentTurnExecution(lease);
      if (isApprovedDurableAnalysisTurn(execution.input)) await repository.startAgentAnalysis(lease);
      else await (dependencies.runtime ?? new AgentRuntime(repository)).resumeDurableTurn(lease, cancellation.signal);
    }
    if (cancellation.signal.aborted) throw new Error('LEASE_LOST');
    log(JSON.stringify({event:'agent_turn_phase_completed',job_id:lease.job.job_id}));
  } catch (cause) {
    const repositoryCode = safeRepositoryCode(cause);
    const code = repositoryCode && publicCodes.has(repositoryCode)
      ? repositoryCode === 'SCOPE_NOT_FOUND' ? 'UNSUPPORTED_SCOPE' : repositoryCode
      : 'AGENT_EXECUTION_FAILED';
    error(JSON.stringify({
      event: 'agent_turn_phase_failed',
      job_id: lease.job.job_id,
      code,
      ...errorDiagnostics(cause),
      ...(repositoryCode ? { repository_code: repositoryCode } : {}),
    }));
    try { await repository.failAgentTurnJob(lease,code); }
    catch { /* Cancelled, revoked, or reclaimed: the newer owner resolves the job. */ }
  } finally {
    active = false;
    stopHeartbeat(heartbeat);
  }
}

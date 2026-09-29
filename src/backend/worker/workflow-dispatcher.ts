import type { Repository } from '@vda/db';
import {
  executeAgentWorkflow,
  executeSpecialistWorkflow,
  isArtifactSpecialist,
} from '@vda/agents/analysis/workflow';
import { errorDiagnostics } from './error-diagnostics';

type Lease = NonNullable<Awaited<ReturnType<Repository['claimRun']>>>;
type Workflow = (
  repository: Repository,
  lease: Lease,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

export async function dispatchWorkflow(
  repository: Repository,
  lease: Lease,
  dependencies: {
    agentWorkflow?: Workflow;
    log?: (message: string) => void;
    error?: (message: string) => void;
    startHeartbeat?: typeof setInterval;
    stopHeartbeat?: typeof clearInterval;
  } = {},
) {
  const {
    agentWorkflow = (repository: Repository, lease: Lease, options?: { signal?: AbortSignal }) =>
      isArtifactSpecialist(lease.run.request.agent_target)
        ? executeSpecialistWorkflow(repository, lease, options)
        : executeAgentWorkflow(repository, lease, options),
    log = console.log,
    error = console.error,
    startHeartbeat = setInterval,
    stopHeartbeat = clearInterval,
  } = dependencies;
  log(
    JSON.stringify({
      event: 'run_started',
      run_id: lease.run.run_id,
      attempt: lease.run.attempt,
    }),
  );
  const cancellation = new AbortController();
  let active = true;
  const heartbeat = startHeartbeat(() => {
    void repository.renewLease(lease).catch((cause) => {
      // Stop cooperative agents/tools immediately; existing stage writes also
      // remain fenced, including adapters that cannot interrupt their work.
      if (!active || cancellation.signal.aborted) return;
      cancellation.abort();
      error(
        JSON.stringify({
          event: 'run_lease_renewal_failed',
          run_id: lease.run.run_id,
          attempt: lease.run.attempt,
          ...errorDiagnostics(cause),
        }),
      );
    });
  }, 10000);
  try {
    if (lease.run.workflow_version === 'agent-v1')
      await agentWorkflow(repository, lease, { signal: cancellation.signal });
    else throw new Error('UNKNOWN_WORKFLOW_VERSION');
    if (cancellation.signal.aborted) throw new Error('LEASE_LOST');
  } catch (cause) {
    const code =
      cause instanceof Error && /^[A-Z_]{1,80}$/.test(cause.message)
        ? cause.message
        : 'EXECUTION_FAILED';
    error(
      JSON.stringify({
        event: 'run_failed',
        run_id: lease.run.run_id,
        code: code.slice(0, 200),
        ...errorDiagnostics(cause),
      }),
    );
    try {
      await repository.failRun(lease, 'EXECUTION_FAILED');
    } catch {
      /* Lost lease or cancellation already terminal. */
    }
  } finally {
    active = false;
    stopHeartbeat(heartbeat);
  }
}

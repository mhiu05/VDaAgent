import type { Repository } from '@vda/db';
import { executeAgentWorkflow, executeSpecialistWorkflow, isArtifactSpecialist } from '@vda/agents/analysis-v1/workflow';
import { executeLease } from '@vda/agents/legacy-workflow/workflow';

type Lease = NonNullable<Awaited<ReturnType<Repository['claimRun']>>>;
type Workflow = (repository: Repository, lease: Lease, options?: { signal?: AbortSignal }) => Promise<unknown>;

export async function dispatchWorkflow(
  repository: Repository,
  lease: Lease,
  dependencies: {
    agentWorkflow?: Workflow;
    legacyWorkflow?: Workflow;
    log?: (message: string) => void;
    error?: (message: string) => void;
    startHeartbeat?: typeof setInterval;
    stopHeartbeat?: typeof clearInterval;
  } = {},
) {
  const {
    agentWorkflow = (repository: Repository, lease: Lease, options?: { signal?: AbortSignal }) =>
      isArtifactSpecialist(lease.run.request.agent_target) ? executeSpecialistWorkflow(repository, lease, options) : executeAgentWorkflow(repository, lease, options),
    legacyWorkflow = executeLease,
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
  const heartbeat = startHeartbeat(() => {
    void repository.renewLease(lease).catch(() => {
      // Stop cooperative agents/tools immediately; existing stage writes also
      // remain fenced, including adapters that cannot interrupt their work.
      cancellation.abort();
    });
  }, 10000);
  try {
    // Release A keeps the legacy executor solely to drain existing runs.
    if (lease.run.workflow_version === 'agent-v1') await agentWorkflow(repository, lease, { signal: cancellation.signal });
    else if (lease.run.workflow_version === 'legacy-v1') await legacyWorkflow(repository, lease);
    else throw new Error('UNKNOWN_WORKFLOW_VERSION');
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
      }),
    );
    try {
      await repository.failRun(lease, 'EXECUTION_FAILED');
    } catch {
      /* Lost lease or cancellation already terminal. */
    }
  } finally {
    stopHeartbeat(heartbeat);
  }
}

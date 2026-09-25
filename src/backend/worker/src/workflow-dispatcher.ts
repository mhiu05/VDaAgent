import type { Repository } from '@vda/db';
import { executeAgentWorkflow } from '@vda/agents/analysis-v1/workflow';
import { executeLease } from '@vda/agents/legacy-workflow/workflow';

type Lease = NonNullable<Awaited<ReturnType<Repository['claimRun']>>>;
type Workflow = (repository: Repository, lease: Lease) => Promise<void>;

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
    agentWorkflow = executeAgentWorkflow,
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
  const heartbeat = startHeartbeat(() => {
    void repository.renewLease(lease).catch(() => {
      /* Fenced writes stop execution if ownership is lost. */
    });
  }, 10000);
  try {
    // A run pins its execution path when it is created. The flag only
    // selects defaults for new runs; it cannot divert queued legacy work
    // into the Reviewer gate mid-flight.
    await (lease.run.workflow_version === 'agent-v1' ? agentWorkflow : legacyWorkflow)(
      repository,
      lease,
    );
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

import { randomUUID } from 'node:crypto';
import { createRepository, type Repository } from '@vda/db';
import { executeAgentWorkflow, executeLease } from '@vda/agents';
import { getConfig } from '@vda/config';
const config = getConfig();
let repository: Repository;
try {
  repository = await createRepository({
    databaseUrl: config.SUPABASE_DB_URL,
    storageUrl: config.NEXT_PUBLIC_SUPABASE_URL,
    storageKey: config.SUPABASE_SECRET_KEY,
    workflowVersion: config.AGENT_WORKFLOW_ENABLED ? 'agent-v1' : 'legacy-v1',
  });
} catch (error) {
  const hostname = (() => {
    try {
      return new URL(config.SUPABASE_DB_URL).hostname;
    } catch {
      return 'invalid-host';
    }
  })();
  const type = error instanceof Error ? error.name : typeof error;
  console.error(
    JSON.stringify({ event: 'database_connection_failed', hostname, error_type: type }),
  );
  process.exit(1);
}
const workerId = `worker-${randomUUID()}`;
let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});
try {
  if (process.argv.includes('--scheduler-once')) {
    const at = process.env.SCHEDULER_NOW ? new Date(process.env.SCHEDULER_NOW) : new Date();
    if (Number.isNaN(at.getTime())) throw new Error('Invalid SCHEDULER_NOW');
    const occurrences = await repository.tick(at);
    console.log(
      JSON.stringify({
        event: 'scheduler_tick',
        occurrences: occurrences.length,
        run_ids: occurrences.map((x) => x.run_id),
      }),
    );
  } else {
    let nextTick = 0;
    do {
      if (Date.now() >= nextTick) {
        await repository.tick();
        nextTick = Date.now() + 60000;
      }
      const lease = await repository.claimRun(workerId);
      if (lease) {
        console.log(
          JSON.stringify({
            event: 'run_started',
            run_id: lease.run.run_id,
            attempt: lease.run.attempt,
          }),
        );
        const heartbeat = setInterval(() => {
          void repository.renewLease(lease).catch(() => {
            /* Fenced writes stop execution if ownership is lost. */
          });
        }, 10000);
        try {
          // A run pins its execution path when it is created. The flag only
          // selects defaults for new runs; it cannot divert queued legacy work
          // into the Reviewer gate mid-flight.
          await (lease.run.workflow_version === 'agent-v1' ? executeAgentWorkflow : executeLease)(
            repository,
            lease,
          );
        } catch (error) {
          const code =
            error instanceof Error && /^[A-Z_]{1,80}$/.test(error.message)
              ? error.message
              : 'EXECUTION_FAILED';
          console.error(
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
          clearInterval(heartbeat);
        }
      } else if (!process.argv.includes('--once'))
        await new Promise((resolve) => setTimeout(resolve, 500));
    } while (!stopped && !process.argv.includes('--once'));
  }
} catch (error) {
  const hostname = new URL(config.SUPABASE_DB_URL).hostname;
  const type = error instanceof Error ? error.name : typeof error;
  console.error(JSON.stringify({ event: 'worker_failed', hostname, error_type: type }));
  process.exitCode = 1;
} finally {
  await repository.close();
}

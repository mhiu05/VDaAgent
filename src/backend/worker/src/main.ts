import { randomUUID } from 'node:crypto';
import { createRepository, type Repository } from '@vda/db';
import { getConfig } from '@vda/config';
import { watchShutdownSignals } from './lifecycle';
import { runLoop } from './run-loop';
import { runSchedulerOnce } from './scheduler';

export async function main() {
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
  const shouldStop = watchShutdownSignals();
  try {
    // Rollback disables new HTTP enqueues; an existing durable queue still drains.
    const durableSchemaAvailable = await repository.hasAgentExecutionSchema();
    if (config.DURABLE_AGENT_EXECUTION_ENABLED && !durableSchemaAvailable)
      throw new Error('AGENT_EXECUTION_SCHEMA_REQUIRED');
    if (process.argv.includes('--scheduler-once')) await runSchedulerOnce(repository);
    else await runLoop(repository, workerId, shouldStop, process.argv.includes('--once'), {
      durableAgentExecution: durableSchemaAvailable,
    });
  } catch (error) {
    const hostname = new URL(config.SUPABASE_DB_URL).hostname;
    const type = error instanceof Error ? error.name : typeof error;
    console.error(JSON.stringify({ event: 'worker_failed', hostname, error_type: type }));
    process.exitCode = 1;
  } finally {
    await repository.close();
  }
}

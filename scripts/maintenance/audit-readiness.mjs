import postgres from 'postgres';

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const match = argument.match(/^--(expect-project|run-id)=(.+)$/);
    if (!match) throw new Error('AUDIT_ARGUMENT_INVALID');
    return [match[1], match[2]];
  }),
);
const databaseUrl = process.env.SUPABASE_DB_URL;
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!databaseUrl || !apiUrl || !options['expect-project']) throw new Error('AUDIT_TARGET_REQUIRED');
if (options['run-id'] && !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(options['run-id']))
  throw new Error('AUDIT_RUN_ID_INVALID');

const database = new URL(databaseUrl);
const api = new URL(apiUrl);
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const local = localHosts.has(database.hostname) && localHosts.has(api.hostname);
const projectRef = api.hostname.endsWith('.supabase.co')
  ? api.hostname.slice(0, -'.supabase.co'.length)
  : null;
if (
  local
    ? options['expect-project'] !== 'local'
    : !projectRef ||
      options['expect-project'] !== projectRef ||
      !decodeURIComponent(database.username).endsWith(`.${projectRef}`)
)
  throw new Error('AUDIT_TARGET_MISMATCH');

const client = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
  ssl: local ? false : 'require',
});

try {
  const result = await client.begin(async (sql) => {
    await sql.unsafe('SET TRANSACTION READ ONLY');
    await sql.unsafe("SET LOCAL statement_timeout = '5s'");
    const [identity] = await sql.unsafe(`
      SELECT current_database() AS database_name, now() AS observed_at,
        to_regclass('public.agent_turn_jobs') IS NOT NULL AS has_turn_jobs`);
    const activeRuns = await sql.unsafe(`
      WITH active AS (
        SELECT org_id, status, worker_id, lease_until,
          CASE
            WHEN jsonb_typeof(payload) <> 'object' THEN '[invalid-payload]'
            WHEN NOT payload ? 'workflow_version' THEN 'legacy-v1'
            WHEN jsonb_typeof(payload->'workflow_version') <> 'string' THEN '[invalid-version]'
            ELSE payload->>'workflow_version'
          END AS workflow_version
        FROM public.runs WHERE status IN ('queued', 'running')
      )
      SELECT org_id, workflow_version, status, count(*)::int AS total,
        count(*) FILTER (WHERE lease_until > now())::int AS live_leases,
        count(*) FILTER (WHERE worker_id IS NOT NULL)::int AS owned_runs
      FROM active GROUP BY org_id, workflow_version, status
      ORDER BY org_id, workflow_version, status`);
    const legacyJobs = identity.has_turn_jobs
      ? await sql.unsafe(`
      SELECT j.org_id, r.status AS run_status, j.status AS job_status, count(*)::int AS total,
        count(*) FILTER (WHERE j.lease_until > now())::int AS live_leases
      FROM public.agent_turn_jobs j
      JOIN public.runs r ON r.org_id = j.org_id AND r.id = j.run_id
      WHERE (NOT r.payload ? 'workflow_version' OR
        r.payload->>'workflow_version' = 'legacy-v1') AND
        (j.status IN ('queued', 'running', 'waiting') OR j.lease_until > now())
      GROUP BY j.org_id, r.status, j.status ORDER BY j.org_id, r.status, j.status`)
      : [];
    const legacyLeases = await sql.unsafe(`
      SELECT org_id, status, count(*)::int AS total
      FROM public.runs
      WHERE lease_until > now() AND
        (NOT payload ? 'workflow_version' OR payload->>'workflow_version' = 'legacy-v1')
      GROUP BY org_id, status ORDER BY org_id, status`);
    let incident = null;
    if (options['run-id']) {
      const [run] = await sql.unsafe(
        `
        SELECT org_id, id AS run_id, status, worker_id, lease_until,
          fencing_token, created_at, payload->>'workflow_version' AS stored_workflow_version,
          payload->>'attempt' AS attempt
        FROM public.runs WHERE id = $1`,
        [options['run-id']],
      );
      const jobs = identity.has_turn_jobs
        ? await sql.unsafe(
            `
        SELECT org_id, id AS job_id, status, run_id, attempt, worker_id,
          lease_until, error_code, created_at, updated_at
        FROM public.agent_turn_jobs WHERE run_id = $1
        ORDER BY created_at, id`,
            [options['run-id']],
          )
        : [];
      const [tasks] = await sql.unsafe(
        `
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE payload->>'status' IN ('pending', 'running'))::int AS active
        FROM public.tasks WHERE run_id = $1`,
        [options['run-id']],
      );
      const taskStates = await sql.unsafe(
        `
        SELECT payload->>'kind' AS kind, payload->>'status' AS status,
          count(*)::int AS total
        FROM public.tasks WHERE run_id = $1
        GROUP BY payload->>'kind', payload->>'status'
        ORDER BY kind, status`,
        [options['run-id']],
      );
      const messages = await sql.unsafe(
        `
        SELECT role, status, count(*)::int AS total FROM public.messages
        WHERE run_id = $1 GROUP BY role, status ORDER BY role, status`,
        [options['run-id']],
      );
      incident = { run: run ?? null, jobs, tasks, task_states: taskStates, messages };
    }
    return {
      identity,
      active_runs: activeRuns,
      legacy_linked_jobs: legacyJobs,
      legacy_live_leases: legacyLeases,
      incident,
    };
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        project_ref: projectRef ?? 'local',
        database_host: database.hostname,
        ...result,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      error: 'AUDIT_READ_FAILED',
      type: error instanceof Error ? error.name : typeof error,
      code: error && typeof error === 'object' && 'code' in error ? error.code : null,
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await client.end();
}

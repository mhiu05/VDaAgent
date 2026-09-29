import type {
  AnalysisRequest,
  AnalysisRun,
  MessagePart,
  MessageStatus,
  RunEvent,
  RunTask,
  UnitSnapshot,
} from '@vda/contracts';
import { authorizeInTransaction } from '../authorization/authorization-repository';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { normalizeRun } from '../mapping/run';
import { json } from '../mapping/rows';
import type { QueryResult } from '../types';
import { terminalizeRun } from '../workflow/terminal-run';

export function listRuns(db: Driver, user: string, org: string): Promise<AnalysisRun[]> {
  return db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org);
    const rows = await tx.query('SELECT payload FROM runs WHERE org_id=$1', [org]);
    return rows.map(normalizeRun).sort((a, b) => b.created_at.localeCompare(a.created_at));
  });
}

export function getRun(db: Driver, user: string, org: string, id: string) {
  return db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org);
    const run = await readRun(tx, org, id);
    const tasks = (
      await tx.query('SELECT payload FROM tasks WHERE org_id=$1 AND run_id=$2', [org, id])
    ).map(json) as RunTask[];
    const events = (
      await tx.query('SELECT payload FROM events WHERE org_id=$1 AND run_id=$2', [org, id])
    ).map(json) as RunEvent[];
    return { run, tasks, events };
  });
}

export async function readRun(
  tx: Driver,
  org: string,
  id: string,
  lock = false,
): Promise<AnalysisRun> {
  const rows = await tx.query(
    `SELECT payload FROM runs WHERE org_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
    [org, id],
  );
  if (!rows[0]) fail('RUN_NOT_FOUND', 404);
  return normalizeRun(rows[0]);
}

const now = () => new Date().toISOString();

export async function updateRun(tx: Driver, run: AnalysisRun, worker: string | null = null) {
  run.updated_at = now();
  await tx.query(
    `UPDATE runs SET status=$1,lease_until=$2,fencing_token=$3,worker_id=$4,
     payload=CASE WHEN payload ? 'workflow_version' THEN $5::jsonb
       ELSE $5::jsonb - 'workflow_version' END WHERE org_id=$6 AND id=$7`,
    [
      run.status,
      run.lease_until,
      run.fencing_token,
      worker,
      JSON.stringify(run),
      run.org_id,
      run.run_id,
    ],
  );
}

type FinalizeAssistant = (
  tx: Driver,
  run: AnalysisRun,
  result: {
    status: Extract<MessageStatus, 'completed' | 'failed' | 'cancelled' | 'in_progress'>;
    content: string;
    parts: MessagePart[];
  },
) => Promise<void>;

export async function cancelRun(db: Driver, user: string, org: string, id: string) {
  await db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org, true);
    const run = await readRun(tx, org, id, true);
    if (run.workflow_version !== 'agent-v1') fail('HISTORICAL_RUN_READ_ONLY', 409);
    if (run.status === 'succeeded' || run.status === 'failed') fail('RUN_TERMINAL', 409);
    run.cancel_requested = true;
    run.status = 'cancelled';
    run.lease_until = null;
    run.fencing_token++;
    await updateRun(tx, run);
    await terminalizeRun(tx, run, 'cancelled', 'RUN_CANCELLED');
  });
}

export async function retryRun(
  db: Driver,
  finalizeAssistant: FinalizeAssistant,
  user: string,
  org: string,
  id: string,
) {
  return db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org, true);
    const run = await readRun(tx, org, id, true);
    if (run.status !== 'failed') fail('RUN_NOT_RETRYABLE', 409);
    if (run.workflow_version !== 'agent-v1') fail('HISTORICAL_RUN_READ_ONLY', 409);
    const linkedJob = await tx.query(
      'SELECT id FROM agent_turn_jobs WHERE org_id=$1 AND run_id=$2 LIMIT 1',
      [org, id],
    );
    if (linkedJob[0]) fail('DURABLE_RUN_RETRY_REQUIRES_NEW_TURN', 409);
    if (run.attempt >= 3) fail('RUN_MAX_ATTEMPTS', 409);
    await authorizeInTransaction(tx, run.created_by, org, true);
    run.status = 'queued';
    run.error_code = null;
    await updateRun(tx, run);
    await finalizeAssistant(tx, run, {
      status: 'in_progress',
      content: 'Đang chuẩn bị chạy lại phân tích.',
      parts: [
        { type: 'text', text: 'Đang chuẩn bị chạy lại phân tích.' },
        { type: 'run_ref', run_id: run.run_id, status: 'queued' },
      ],
    });
    return run;
  });
}

function querySpec(request: AnalysisRequest) {
  return {
    sql: 'WITH targets(target_date) AS (VALUES (CAST($2 AS date)),(CAST($2 AS date)-7),(CAST($2 AS date)-30),(CAST($2 AS date)-90)), ranked AS (SELECT DISTINCT ON (t.target_date,s.unit_external_id) s.payload,s.snapshot_date,s.unit_external_id FROM targets t JOIN snapshots s ON s.org_id=$1 AND s.project_external_id=$3 AND s.snapshot_date<=t.target_date ORDER BY t.target_date,s.unit_external_id,s.snapshot_date DESC) SELECT DISTINCT payload,snapshot_date,unit_external_id FROM ranked ORDER BY snapshot_date,unit_external_id LIMIT 20001',
    parameters: [request.org_id, request.data_as_of, request.scope.project_external_id],
    row_limit: 20000,
    timeout_ms: 5000,
  };
}

export async function selectLatest(tx: Driver, request: AnalysisRequest): Promise<QueryResult> {
  const spec = querySpec(request);
  await tx.query("SET LOCAL statement_timeout = '5s'");
  const rows = (await tx.query(spec.sql, spec.parameters)).map(json) as UnitSnapshot[];
  if (rows.length > spec.row_limit) fail('QUERY_ROW_LIMIT_EXCEEDED', 422);
  return { ...spec, rows };
}

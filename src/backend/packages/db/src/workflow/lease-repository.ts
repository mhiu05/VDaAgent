import type { AnalysisRun, UnitSnapshot } from '@vda/contracts';
import { authorizeInTransaction } from '../authorization/authorization-repository';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { normalizeRun } from '../mapping/run';
import { json } from '../mapping/rows';
import { readRun, updateRun } from '../repositories/run-repository';
import type { Lease, QueryResult } from '../types';

const now = () => new Date().toISOString();

export async function claimNextRun(
  db: Driver,
  worker: string,
  date = new Date(),
  leaseMs = 30000,
): Promise<Lease | null> {
  return db.transaction(async (tx) => {
    const candidates = await tx.query(
      "SELECT payload FROM runs WHERE status='queued' OR (status='running' AND lease_until<$1) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
      [date.toISOString()],
    );
    if (!candidates[0]) return null;
    const run = normalizeRun(candidates[0]);
    if (run.attempt >= 3) {
      run.status = 'failed';
      run.error_code = 'MAX_ATTEMPTS';
      run.lease_until = null;
      await updateRun(tx, run);
      return null;
    }
    try {
      await authorizeInTransaction(tx, run.created_by, run.org_id, true);
    } catch {
      run.status = 'failed';
      run.error_code = 'MEMBERSHIP_REVOKED';
      await updateRun(tx, run);
      return null;
    }
    run.status = 'running';
    run.attempt++;
    run.fencing_token++;
    run.lease_until = new Date(date.getTime() + leaseMs).toISOString();
    await updateRun(tx, run, worker);
    return { run, worker_id: worker, fencing_token: run.fencing_token };
  });
}

export async function fenceRun(tx: Driver, lease: Lease): Promise<AnalysisRun> {
  const run = await readRun(tx, lease.run.org_id, lease.run.run_id, true);
  await authorizeInTransaction(tx, run.created_by, run.org_id, true);
  const owner = await tx.query('SELECT worker_id FROM runs WHERE org_id=$1 AND id=$2', [
    run.org_id,
    run.run_id,
  ]);
  if (
    run.status !== 'running' ||
    run.fencing_token !== lease.fencing_token ||
    run.lease_until! <= now() ||
    owner[0]?.worker_id !== lease.worker_id
  )
    fail('LEASE_LOST', 409);
  return run;
}

export async function assertRunLease(db: Driver, lease: Lease) {
  await db.transaction(async (tx) => {
    await fenceRun(tx, lease);
  });
}

export async function renewRunLease(db: Driver, lease: Lease, ms = 30000) {
  await db.transaction(async (tx) => {
    const run = await fenceRun(tx, lease);
    run.lease_until = new Date(Date.now() + ms).toISOString();
    await updateRun(tx, run, lease.worker_id);
  });
}

export async function readMetricConfig(db: Driver, lease: Lease) {
  return db.transaction(async (tx) => {
    const run = await fenceRun(tx, lease);
    const rows = await tx.query(
      'SELECT slow_moving_threshold_days FROM runs WHERE org_id=$1 AND id=$2',
      [run.org_id, run.run_id],
    );
    return { slow_moving_threshold_days: Number(rows[0].slow_moving_threshold_days) };
  });
}

export async function readPinnedSnapshots(db: Driver, lease: Lease): Promise<QueryResult> {
  return db.transaction(async (tx) => {
    const run = await fenceRun(tx, lease);
    const sql =
      'SELECT s.payload FROM snapshots s JOIN run_snapshots r ON r.org_id=s.org_id AND r.snapshot_id=s.id WHERE r.org_id=$1 AND r.run_id=$2 ORDER BY s.snapshot_date,s.unit_external_id LIMIT 20001';
    await tx.query("SET LOCAL statement_timeout = '5s'");
    const parameters = [run.org_id, run.run_id];
    const rows = (await tx.query(sql, parameters)).map(json) as UnitSnapshot[];
    if (rows.length > 20000) fail('QUERY_ROW_LIMIT_EXCEEDED', 422);
    return { sql, parameters, rows, row_limit: 20000, timeout_ms: 5000 };
  });
}

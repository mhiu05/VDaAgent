import type { Driver } from '../driver';
import { updateRun } from '../repositories/run-repository';
import { fenceRun } from './lease-repository';
import { terminalizeRun } from './terminal-run';
import type { Lease } from '../types';

export async function failRun(db: Driver, lease: Lease, code: string) {
  await db.transaction(async (tx) => {
    const run = await fenceRun(tx, lease);
    run.status = 'failed';
    run.error_code = code;
    run.lease_until = null;
    run.fencing_token++;
    await updateRun(tx, run);
    await terminalizeRun(tx, run, 'failed', code);
  });
}

import type { Driver } from '../driver';
import { updateRun } from '../repositories/run-repository';
import { finishRunAssistant } from './checkpoint-repository';
import { fenceRun } from './lease-repository';
import type { Lease } from '../types';

export async function failRun(db: Driver, lease: Lease, code: string) {
  await db.transaction(async (tx) => {
    const run = await fenceRun(tx, lease);
    run.status = 'failed';
    run.error_code = code;
    run.lease_until = null;
    await updateRun(tx, run);
    await finishRunAssistant(tx, run, {
      status: 'failed',
      content: 'Lượt phân tích không thể hoàn tất.',
      parts: [
        { type: 'text', text: 'Lượt phân tích không thể hoàn tất.' },
        { type: 'run_ref', run_id: run.run_id, status: 'failed' },
        { type: 'error', code, retryable: true },
      ],
    });
  });
}

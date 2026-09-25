import type { Repository } from '@vda/db';

export async function runSchedulerOnce(
  repository: Repository,
  schedulerNow = process.env.SCHEDULER_NOW,
  log: (message: string) => void = console.log,
) {
  const at = schedulerNow ? new Date(schedulerNow) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error('Invalid SCHEDULER_NOW');
  const occurrences = await repository.tick(at);
  log(
    JSON.stringify({
      event: 'scheduler_tick',
      occurrences: occurrences.length,
      run_ids: occurrences.map((x) => x.run_id),
    }),
  );
}

export async function tickWhenDue(
  repository: Repository,
  nextTick: number,
  now: () => number = Date.now,
): Promise<number> {
  if (now() >= nextTick) {
    await repository.tick();
    return now() + 60000;
  }
  return nextTick;
}

import type { Repository } from '@vda/db';
import { tickWhenDue } from './scheduler';
import { dispatchWorkflow } from './workflow-dispatcher';
import { dispatchAgentTurn } from './agent-turn-dispatcher';

export async function runLoop(
  repository: Repository,
  workerId: string,
  shouldStop: () => boolean,
  once: boolean,
  dependencies: {
    now?: () => number;
    sleep?: (ms: number) => Promise<unknown>;
    dispatch?: typeof dispatchWorkflow;
    dispatchAgent?: typeof dispatchAgentTurn;
    durableAgentExecution?: boolean;
  } = {},
) {
  const {
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    dispatch = dispatchWorkflow,
    dispatchAgent = dispatchAgentTurn,
    durableAgentExecution = false,
  } = dependencies;
  let nextTick = 0;
  let preferAgent = true;
  do {
    nextTick = await tickWhenDue(repository, nextTick, now);
    let handled = false;
    if (durableAgentExecution) {
      if (preferAgent) {
        const jobLease = await repository.claimAgentTurnJob(workerId);
        if (jobLease) { await dispatchAgent(repository,jobLease); handled = true; }
      } else {
        const runLease = await repository.claimRun(workerId);
        if (runLease) { await dispatch(repository,runLease); handled = true; }
      }
    }
    if (!handled) {
      if (durableAgentExecution && !preferAgent) {
        const jobLease = await repository.claimAgentTurnJob(workerId);
        if (jobLease) { await dispatchAgent(repository,jobLease); handled = true; }
      } else {
        const lease = await repository.claimRun(workerId);
        if (lease) { await dispatch(repository,lease); handled = true; }
      }
    }
    if (handled) preferAgent = !preferAgent;
    else if (!once) await sleep(500);
  } while (!shouldStop() && !once);
}

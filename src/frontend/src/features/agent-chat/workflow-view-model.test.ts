import { describe, expect, it } from 'vitest';
import type { RunTask } from '@vda/contracts';
import { stageLabel, workflowViewModel } from './workflow-view-model';

function task(kind: RunTask['kind'], dependencies: RunTask['kind'][], status: RunTask['status'] = 'pending'): RunTask {
  return { task_id: kind, run_id: 'run', org_id: 'org', kind, dependencies, status, attempt: 0, error_code: null };
}

const branches: RunTask[] = [
  task('coordinator', [], 'succeeded'), task('data', ['coordinator'], 'succeeded'),
  task('comparison', ['data'], 'succeeded'), task('chart', ['data'], 'running'),
  task('analyst', ['data'], 'failed'), task('insight', ['comparison', 'chart', 'analyst']),
  task('report', ['insight']), task('reviewer', ['report']), task('publication', ['reviewer']),
];

describe('workflowViewModel', () => {
  it('retains independent parallel states and pinned agent-v1 topology', () => {
    const view = workflowViewModel('agent-v1', branches);
    expect(view.layout).toBe('agent');
    expect(view.active.map((item) => item.kind)).toEqual(['chart']);
    expect(view.completed).toBe(3);
    expect(view.tasks.find((item) => item.kind === 'analyst')?.status).toBe('failed');
    expect(stageLabel('analyst', 'agent-v1')).not.toBe(stageLabel('insight', 'agent-v1'));
  });
  it('falls back to returned dependencies if version and edges disagree', () => {
    expect(workflowViewModel('legacy-v1', branches).layout).toBe('generic');
    expect(workflowViewModel('agent-v1', branches.map((item) => item.kind === 'insight' ? { ...item, dependencies: ['chart'] } : item)).layout).toBe('generic');
  });
});

import type { RunTask } from '@vda/contracts';

export type WorkflowDag = readonly {
  kind: RunTask['kind'];
  dependencies: RunTask['kind'][];
}[];

export const AGENT_WORKFLOW_DAG: WorkflowDag = [
  { kind: 'coordinator', dependencies: [] },
  { kind: 'data', dependencies: ['coordinator'] },
  { kind: 'comparison', dependencies: ['data'] },
  { kind: 'chart', dependencies: ['data'] },
  { kind: 'analyst', dependencies: ['data'] },
  { kind: 'insight', dependencies: ['comparison', 'chart', 'analyst'] },
  { kind: 'report', dependencies: ['insight'] },
  { kind: 'reviewer', dependencies: ['report'] },
  { kind: 'publication', dependencies: ['reviewer'] },
];

export const AGENT_DATA_DAG: WorkflowDag = AGENT_WORKFLOW_DAG.slice(0, 2);

import type { RunTask } from '@vda/contracts';

export const DAG: { kind: RunTask['kind']; dependencies: RunTask['kind'][] }[] = [
  { kind: 'orchestrator', dependencies: [] },
  { kind: 'data', dependencies: ['orchestrator'] },
  { kind: 'calculation', dependencies: ['data'] },
  { kind: 'comparison', dependencies: ['calculation'] },
  { kind: 'chart', dependencies: ['calculation', 'comparison'] },
  { kind: 'insight', dependencies: ['chart'] },
  { kind: 'validation', dependencies: ['insight'] },
  { kind: 'report', dependencies: ['validation'] },
];

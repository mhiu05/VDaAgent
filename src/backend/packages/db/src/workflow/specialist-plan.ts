import type { AgentKey } from '@vda/contracts';

/** A specialist artifact run stops at its verified deliverable; reports use the full DAG. */
export const SPECIALIST_PLANS = {
  data: { artifact: 'data_analysis_pack', stages: ['coordinator', 'data'], personas: ['data'] },
  comparison: { artifact: 'comparison_pack', stages: ['coordinator', 'data', 'comparison'], personas: ['data', 'compare'] },
  chart: { artifact: 'chart_pack', stages: ['coordinator', 'data', 'chart'], personas: ['data', 'chart'] },
  analyst: { artifact: 'analysis_pack', stages: ['coordinator', 'data', 'analyst'], personas: ['data', 'analyst'] },
  insight: { artifact: 'insight_pack', stages: ['coordinator', 'data', 'comparison', 'chart', 'analyst', 'insight'], personas: ['data', 'compare', 'chart', 'analyst', 'insight'] },
} as const;

export function specialistPlan(target: AgentKey | null | undefined) {
  return target && target in SPECIALIST_PLANS ? SPECIALIST_PLANS[target as keyof typeof SPECIALIST_PLANS] : null;
}

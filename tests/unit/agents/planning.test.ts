import { describe, expect, it, vi } from 'vitest';
import type { AgentPlanV1 } from '@vda/contracts';
import type { CapabilityRegistry } from '../../../src/backend/agents/runtime/capabilities/registry';
import type { AuthorizedAgentContextV1 } from '../../../src/backend/agents/runtime/context/types';
import { validateAgentPlan } from '../../../src/backend/agents/runtime/planning/planner';

const RUN_A = '50000000-0000-4000-8000-000000000001';
const RUN_B = '50000000-0000-4000-8000-000000000002';
const context = {} as AuthorizedAgentContextV1;

function plan(
  steps: AgentPlanV1['steps'],
  answer_mode: AgentPlanV1['answer_mode'] = 'grounded',
): AgentPlanV1 {
  return {
    version: 'agent-plan-v1',
    intent: 'inspect authorized context',
    steps,
    answer_mode,
    unsupported_reason: null,
  };
}

function registry() {
  const preflight = vi.fn((_context, step: AgentPlanV1['steps'][number]) => ({
    invocation: step,
    descriptor: {
      kind: step.capability_id === 'create_analysis' ? 'mutation' : 'read',
      creates_run: step.capability_id === 'create_analysis',
    },
    input: step.input,
  }));
  return { instance: { preflight } as unknown as CapabilityRegistry, preflight };
}

describe('agent plan preflight', () => {
  it('rejects duplicate capabilities and mixed creation before any repository-facing preflight', () => {
    const { instance, preflight } = registry();
    expect(() =>
      validateAgentPlan(
        plan([
          { step_id: 'one', capability_id: 'get_analysis_result', input: { run_id: RUN_A } },
          { step_id: 'two', capability_id: 'get_analysis_result', input: { run_id: RUN_A } },
        ]),
        instance,
        context,
      ),
    ).toThrow('Each capability can be invoked at most once per plan');
    expect(() =>
      validateAgentPlan(
        plan(
          [
            { step_id: 'read', capability_id: 'get_analysis_result', input: { run_id: RUN_A } },
            {
              step_id: 'create',
              capability_id: 'create_analysis',
              input: { focus: 'current_inventory' },
            },
          ],
          'queued',
        ),
        instance,
        context,
      ),
    ).toThrow('A queued plan must contain only create_analysis');
    expect(preflight).not.toHaveBeenCalled();
  });

  it('rejects a second run before preflighting its data', () => {
    const { instance, preflight } = registry();
    expect(() =>
      validateAgentPlan(
        plan([
          { step_id: 'one', capability_id: 'get_analysis_result', input: { run_id: RUN_A } },
          {
            step_id: 'two',
            capability_id: 'inspect_signal',
            input: { run_id: RUN_B, signal_id: 'signal' },
          },
        ]),
        instance,
        context,
      ),
    ).toThrow('CAPABILITY_DENIED');
    expect(preflight).not.toHaveBeenCalled();
  });

  it('accepts one queued creation', () => {
    const { instance, preflight } = registry();
    const queued = plan(
      [
        {
          step_id: 'create',
          capability_id: 'create_analysis',
          input: { focus: 'current_inventory' },
        },
      ],
      'queued',
    );
    expect(validateAgentPlan(queued, instance, context)).toEqual(queued);
    expect(preflight).toHaveBeenCalledTimes(1);
  });
});

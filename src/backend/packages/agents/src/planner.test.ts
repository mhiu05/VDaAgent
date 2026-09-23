import { describe, expect, it, vi } from 'vitest';
import type { AgentPlanV1 } from '@vda/contracts';
import type { CapabilityRegistry } from './capability-registry';
import { validateAgentPlan } from './planner';
import type { AuthorizedAgentContextV1 } from './runtime-context';

const RUN_A = '50000000-0000-4000-8000-000000000001';
const RUN_B = '50000000-0000-4000-8000-000000000002';

function plan(steps: AgentPlanV1['steps'], answer_mode: AgentPlanV1['answer_mode'] = 'grounded') {
  return {
    version: 'agent-plan-v1',
    intent: 'inspect authorized context',
    steps,
    answer_mode,
    unsupported_reason: null,
  } as AgentPlanV1;
}

function registryFor(
  descriptorFor: (capabilityId: string) => { kind: 'read' | 'mutation'; creates_run: boolean },
) {
  const preflight = vi.fn((_context, invocation) => ({
    invocation,
    descriptor: descriptorFor(invocation.capability_id),
    input: invocation.input,
  }));
  return { registry: { preflight } as unknown as CapabilityRegistry, preflight };
}

const context = {} as AuthorizedAgentContextV1;

describe('validateAgentPlan', () => {
  it('rejects duplicate capability IDs before registry preflight can authorize a step', () => {
    const { registry, preflight } = registryFor(() => ({ kind: 'read', creates_run: false }));
    const duplicate = plan([
      {
        step_id: 'first',
        capability_id: 'get_analysis_result',
        input: { run_id: RUN_A },
      },
      {
        step_id: 'second',
        capability_id: 'get_analysis_result',
        input: { run_id: RUN_A },
      },
    ]);

    expect(() => validateAgentPlan(duplicate, registry, context)).toThrow();
    expect(preflight).not.toHaveBeenCalled();
  });

  it('rejects a mixed create-analysis plan before registry preflight or execution', () => {
    const { registry, preflight } = registryFor((capabilityId) => ({
      kind: capabilityId === 'create_analysis' ? 'mutation' : 'read',
      creates_run: capabilityId === 'create_analysis',
    }));
    const mixed = plan(
      [
        {
          step_id: 'inspect',
          capability_id: 'get_analysis_result',
          input: { run_id: RUN_A },
        },
        {
          step_id: 'create',
          capability_id: 'create_analysis',
          input: { focus: 'current_inventory' },
        },
      ],
      'queued',
    );

    expect(() => validateAgentPlan(mixed, registry, context)).toThrow();
    expect(preflight).not.toHaveBeenCalled();
  });

  it('rejects cross-run reads before a provider plan can cause data from two runs to merge', () => {
    const { registry, preflight } = registryFor(() => ({ kind: 'read', creates_run: false }));
    const crossRun = plan([
      {
        step_id: 'result',
        capability_id: 'get_analysis_result',
        input: { run_id: RUN_A },
      },
      {
        step_id: 'signal',
        capability_id: 'inspect_signal',
        input: { run_id: RUN_B, signal_id: 'low-coverage' },
      },
    ]);

    expect(() => validateAgentPlan(crossRun, registry, context)).toThrow('CAPABILITY_DENIED');
    // The second step is rejected before the registry has an opportunity to
    // perform a data-plane lookup for the other run.
    expect(preflight).toHaveBeenCalledTimes(1);
  });

  it('accepts the sole queued create-analysis operation with server-owned inputs only', () => {
    const { registry, preflight } = registryFor((capabilityId) => ({
      kind: capabilityId === 'create_analysis' ? 'mutation' : 'read',
      creates_run: capabilityId === 'create_analysis',
    }));
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

    expect(validateAgentPlan(queued, registry, context)).toEqual(queued);
    expect(preflight).toHaveBeenCalledTimes(1);
  });
});

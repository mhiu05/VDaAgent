import {
  AgentPlanV1Schema,
  CapabilityInvocationSchema,
  type AgentPlanV1,
  type AgentRuntimeErrorCode,
  type CapabilityInvocation,
} from '@vda/contracts';
import { CapabilityRegistry, CapabilityRegistryError } from '../capabilities/registry';
import {
  MAX_AGENT_CAPABILITY_CALLS,
  MAX_AGENT_MUTATING_CAPABILITY_CALLS,
  MAX_AGENT_NEW_ANALYSIS_RUNS,
  MAX_AGENT_PLAN_STEPS,
} from '../limits';
import type { AuthorizedAgentContextV1 } from '../context/types';

export class PlannerValidationError extends Error {
  constructor(
    readonly code: Extract<
      AgentRuntimeErrorCode,
      'CAPABILITY_DENIED' | 'RUNTIME_LIMIT_EXCEEDED' | 'CAPABILITY_UNAVAILABLE'
    >,
  ) {
    super(code);
  }
}

export type ValidatedAgentPlan = AgentPlanV1 & { steps: CapabilityInvocation[] };

function invocationRunId(step: CapabilityInvocation) {
  return 'run_id' in step.input ? step.input.run_id : null;
}

/**
 * Parse and validate every plan step before execution. This is intentionally
 * side-effect-free: no capability executor is called from this function.
 */
export function validateAgentPlan(
  value: unknown,
  registry: CapabilityRegistry,
  context: AuthorizedAgentContextV1,
): ValidatedAgentPlan {
  const plan = AgentPlanV1Schema.parse(value);
  if (plan.steps.length > MAX_AGENT_PLAN_STEPS || plan.steps.length > MAX_AGENT_CAPABILITY_CALLS)
    throw new PlannerValidationError('RUNTIME_LIMIT_EXCEEDED');
  const stepIds = new Set<string>();
  const capabilityIds = new Set<string>();
  let mutationCalls = 0;
  let newRuns = 0;
  let selectedRunId: string | null = null;

  for (const stepValue of plan.steps) {
    const step = CapabilityInvocationSchema.parse(stepValue);
    if (stepIds.has(step.step_id) || capabilityIds.has(step.capability_id))
      throw new PlannerValidationError('RUNTIME_LIMIT_EXCEEDED');
    stepIds.add(step.step_id);
    capabilityIds.add(step.capability_id);
    const runId = invocationRunId(step);
    if (runId !== null) {
      if (selectedRunId !== null && selectedRunId !== runId)
        throw new PlannerValidationError('CAPABILITY_DENIED');
      selectedRunId = runId;
    }
    let descriptor;
    try {
      ({ descriptor } = registry.preflight(context, step));
    } catch (error) {
      if (error instanceof CapabilityRegistryError)
        throw new PlannerValidationError(
          error.code === 'RUNTIME_LIMIT_EXCEEDED' ? error.code : 'CAPABILITY_DENIED',
        );
      throw new PlannerValidationError('CAPABILITY_DENIED');
    }
    if (descriptor.kind === 'mutation') mutationCalls++;
    if (descriptor.creates_run) newRuns++;
  }

  if (mutationCalls > MAX_AGENT_MUTATING_CAPABILITY_CALLS || newRuns > MAX_AGENT_NEW_ANALYSIS_RUNS)
    throw new PlannerValidationError('RUNTIME_LIMIT_EXCEEDED');
  const hasCreate = capabilityIds.has('create_analysis');
  if (capabilityIds.has('inspect_agent_checkpoint') && plan.steps.length !== 1)
    throw new PlannerValidationError('CAPABILITY_DENIED');
  if (hasCreate && (plan.steps.length !== 1 || plan.answer_mode !== 'queued'))
    throw new PlannerValidationError('RUNTIME_LIMIT_EXCEEDED');
  if (!hasCreate && plan.answer_mode === 'queued')
    throw new PlannerValidationError('CAPABILITY_DENIED');
  if (plan.answer_mode === 'grounded' && mutationCalls !== 0)
    throw new PlannerValidationError('CAPABILITY_DENIED');
  if (plan.answer_mode === 'unavailable' && plan.steps.length !== 0)
    throw new PlannerValidationError('CAPABILITY_DENIED');
  if (plan.answer_mode === 'unavailable' && !plan.unsupported_reason)
    throw new PlannerValidationError('CAPABILITY_UNAVAILABLE');
  if (plan.answer_mode !== 'unavailable' && plan.unsupported_reason !== null)
    throw new PlannerValidationError('CAPABILITY_DENIED');
  return plan;
}

export function plannerErrorCode(error: unknown): AgentRuntimeErrorCode | null {
  if (error instanceof PlannerValidationError || error instanceof CapabilityRegistryError)
    return error.code;
  return null;
}

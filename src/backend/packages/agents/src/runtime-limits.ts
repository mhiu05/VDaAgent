/**
 * P0 runtime limits are server-owned. Models, requests, and provider adapters
 * receive only already-bounded projections and cannot raise these values.
 */
export const AGENT_RUNTIME_LIMITS = Object.freeze({
  max_plan_steps: 3,
  max_capability_calls: 3,
  max_invocations_per_capability: 1,
  max_new_analysis_runs: 1,
  max_mutating_capability_calls: 1,
  max_logical_planner_calls: 1,
  max_logical_composer_calls: 1,
  max_provider_attempts_per_stage: 2,
  max_recent_messages: 12,
  max_authorized_historical_runs: 5,
  max_provider_projection_bytes: 24 * 1024,
  max_composer_observations: 12,
  max_workspace_actions: 8,
  max_grounding_refs_per_observation: 12,
  default_provider_attempt_timeout_ms: 12_000,
  max_turn_timeout_ms: 45_000,
} as const);

export type AgentRuntimeLimits = typeof AGENT_RUNTIME_LIMITS & {
  provider_attempt_timeout_ms: number;
  turn_timeout_ms: number;
};

export function runtimeLimits(input?: {
  AGENT_PROVIDER_TIMEOUT_MS?: number;
  AGENT_TURN_TIMEOUT_MS?: number;
}): AgentRuntimeLimits {
  const providerAttemptTimeout =
    input?.AGENT_PROVIDER_TIMEOUT_MS ?? AGENT_RUNTIME_LIMITS.default_provider_attempt_timeout_ms;
  const turnTimeout = input?.AGENT_TURN_TIMEOUT_MS ?? AGENT_RUNTIME_LIMITS.max_turn_timeout_ms;
  if (
    !Number.isInteger(providerAttemptTimeout) ||
    providerAttemptTimeout < 1_000 ||
    providerAttemptTimeout > AGENT_RUNTIME_LIMITS.max_turn_timeout_ms
  )
    throw new Error('AGENT_PROVIDER_TIMEOUT_MS_INVALID');
  if (
    !Number.isInteger(turnTimeout) ||
    turnTimeout < 1_000 ||
    turnTimeout > AGENT_RUNTIME_LIMITS.max_turn_timeout_ms
  )
    throw new Error('AGENT_TURN_TIMEOUT_MS_INVALID');
  if (providerAttemptTimeout > turnTimeout) throw new Error('AGENT_PROVIDER_TIMEOUT_EXCEEDS_TURN');
  return {
    ...AGENT_RUNTIME_LIMITS,
    provider_attempt_timeout_ms: providerAttemptTimeout,
    turn_timeout_ms: turnTimeout,
  };
}

// Named exports keep the existing runtime/context call sites explicit while
// making the frozen object the single source for product defaults.
export const MAX_AGENT_PLAN_STEPS = AGENT_RUNTIME_LIMITS.max_plan_steps;
export const MAX_AGENT_CAPABILITY_CALLS = AGENT_RUNTIME_LIMITS.max_capability_calls;
export const MAX_AGENT_NEW_ANALYSIS_RUNS = AGENT_RUNTIME_LIMITS.max_new_analysis_runs;
export const MAX_AGENT_MUTATING_CAPABILITY_CALLS =
  AGENT_RUNTIME_LIMITS.max_mutating_capability_calls;
export const MAX_AGENT_PLANNER_CALLS = AGENT_RUNTIME_LIMITS.max_logical_planner_calls;
export const MAX_AGENT_COMPOSER_CALLS = AGENT_RUNTIME_LIMITS.max_logical_composer_calls;
export const MAX_AGENT_PROVIDER_ATTEMPTS = AGENT_RUNTIME_LIMITS.max_provider_attempts_per_stage;
export const MAX_AGENT_RECENT_MESSAGES = AGENT_RUNTIME_LIMITS.max_recent_messages;
export const MAX_AGENT_AUTHORIZED_HISTORICAL_RUNS =
  AGENT_RUNTIME_LIMITS.max_authorized_historical_runs;
export const MAX_AGENT_PROVIDER_CONTEXT_BYTES = AGENT_RUNTIME_LIMITS.max_provider_projection_bytes;
export const MAX_AGENT_COMPOSER_OBSERVATIONS = AGENT_RUNTIME_LIMITS.max_composer_observations;
export const MAX_AGENT_WORKSPACE_ACTIONS = AGENT_RUNTIME_LIMITS.max_workspace_actions;
export const MAX_AGENT_GROUNDING_REFS_PER_OBSERVATION =
  AGENT_RUNTIME_LIMITS.max_grounding_refs_per_observation;
/** @deprecated Use MAX_AGENT_PROVIDER_CONTEXT_BYTES. */
export const MAX_AGENT_PLANNED_OBSERVATION_BYTES = MAX_AGENT_PROVIDER_CONTEXT_BYTES;
export const MAX_AGENT_TURN_TIMEOUT_MS = AGENT_RUNTIME_LIMITS.max_turn_timeout_ms;

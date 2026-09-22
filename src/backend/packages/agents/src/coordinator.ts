import {
  CoordinatorDecisionSchema,
  type AgentKey,
  type AnalysisRun,
  type CoordinatorDecision,
  type UseCaseCapability,
} from '@vda/contracts';
import { stableId } from '@vda/domain';
import { getUseCaseDefinition, supportsUseCaseCapability } from './use-cases';

/** A stable, non-user-facing error code for deterministic coordinator rejection. */
export class CoordinatorError extends Error {
  constructor(readonly code: 'UNSUPPORTED_CAPABILITY') {
    super(code);
  }
}

export type CoordinatorInput = {
  run: AnalysisRun;
  requested_capability?: UseCaseCapability;
  agent_target?: AgentKey | null;
};

/**
 * Resolves a run that has already passed repository authorization and scope
 * validation. This adapter intentionally has no model, SQL, metric, or
 * persistence dependency; scheduled and interactive runs use the same path.
 */
export function coordinateRun(input: CoordinatorInput): CoordinatorDecision {
  const { run } = input;
  const definition = getUseCaseDefinition(run.request.use_case);
  const requestedCapability = input.requested_capability ?? 'analysis';
  if (!supportsUseCaseCapability(definition, requestedCapability))
    throw new CoordinatorError('UNSUPPORTED_CAPABILITY');

  return CoordinatorDecisionSchema.parse({
    contract_version: 'coordinator-decision-v1',
    decision_id: stableId(`${run.run_id}:coordinator-decision`),
    org_id: run.org_id,
    use_case: definition.key,
    use_case_version: definition.version,
    scope: run.request.scope,
    // Snapshot pinning occurs before the worker claim. The coordinator never
    // substitutes a later date or discovers data outside the pinned request.
    requested_data_as_of: run.request.data_as_of,
    effective_data_as_of: run.request.data_as_of,
    comparison_windows_days: definition.comparison_windows_days,
    entrypoint: run.entrypoint,
    requested_capability: requestedCapability,
    agent_target: input.agent_target ?? run.request.agent_target ?? null,
    action: 'new_run',
    reuse_run_id: null,
    unsupported_reason: null,
  });
}

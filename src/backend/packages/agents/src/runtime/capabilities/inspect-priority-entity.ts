import {
  InspectPriorityEntityCapabilityInputSchema,
  type AvailableWorkspaceActionV1,
} from '@vda/contracts';
import type { Repository } from '@vda/db';
import { CapabilityRegistryError, type RuntimeCapabilityExecutionContext } from './contracts';
import {
  unavailable,
  visibleMetrics,
  visibleEvidence,
  observation,
  boundedGroundingRefs,
  capabilityResult,
} from './projection';

export async function inspectPriorityEntity(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = InspectPriorityEntityCapabilityInputSchema.parse(input);
  const authorized = context.authorized_context;
  if (
    !authorized.active_priority_entity ||
    authorized.active_priority_entity.run_id !== parsed.run_id ||
    authorized.active_priority_entity.priority_entity_id !== parsed.priority_entity_id
  )
    throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const decision = await repository.decisionIntelligence(
    authorized.actor.user_id,
    authorized.org_id,
    parsed.run_id,
  );
  if (decision.status !== 'available')
    return unavailable('inspect_priority_entity', 'inspect_priority_entity-1');
  const entity = decision.decision_intelligence.priority_entities.find(
    (item) => item.priority_entity_id === parsed.priority_entity_id,
  );
  if (!entity) throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const metrics = await visibleMetrics(repository, authorized, parsed.run_id, entity.metric_refs);
  const evidence = await visibleEvidence(
    repository,
    authorized,
    parsed.run_id,
    entity.evidence_refs,
  );
  const actions: AvailableWorkspaceActionV1[] = [
    {
      action_id: 'inspect-priority-entity-focus',
      action: {
        type: 'focus_priority_entity',
        run_id: parsed.run_id,
        priority_entity_id: parsed.priority_entity_id,
      },
    },
    ...entity.drilldown_ids.slice(0, 3).map((drilldownId, index) => ({
      action_id: `inspect-priority-entity-drilldown-${index + 1}`,
      action: { type: 'open_drilldown' as const, run_id: parsed.run_id, drilldown_id: drilldownId },
    })),
  ];
  return capabilityResult(
    'inspect_priority_entity',
    'available',
    [
      observation(
        'inspect_priority_entity-1',
        'decision',
        'available',
        entity.entity.label,
        boundedGroundingRefs([
          { type: 'run', ref: { run_id: parsed.run_id, status: 'succeeded' } },
          ...metrics.map((ref) => ({ type: 'metric', ref })),
          ...evidence.map((ref) => ({ type: 'evidence', ref })),
        ]),
        { support_level: entity.support_level },
      ),
    ],
    { available_workspace_actions: actions },
  );
}

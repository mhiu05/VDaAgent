import {
  InspectDecisionIntelligenceCapabilityInputSchema,
  type AvailableWorkspaceActionV1,
} from '@vda/contracts';
import type { Repository } from '@vda/db';
import { type RuntimeCapabilityExecutionContext } from './contracts';
import {
  requireAllowedRun,
  unavailable,
  visibleArtifacts,
  observation,
  visibleEvidence,
  visibleMetrics,
  boundedGroundingRefs,
  capabilityResult,
} from './projection';

export async function inspectDecisionIntelligence(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = InspectDecisionIntelligenceCapabilityInputSchema.parse(input);
  const authorized = context.authorized_context;
  requireAllowedRun(authorized, parsed.run_id);
  const decision = await repository
    .decisionIntelligence(authorized.actor.user_id, authorized.org_id, parsed.run_id)
    .catch(() => null);
  if (!decision || decision.status !== 'available')
    return unavailable('inspect_decision_intelligence', 'inspect_decision_intelligence-1');
  const pack = decision.decision_intelligence;
  const artifacts = await visibleArtifacts(repository, authorized, parsed.run_id, [
    decision.decision_intelligence_artifact_id,
    decision.report_artifact_id,
  ]);
  const artifactGrounding = artifacts.map((ref) => ({ type: 'artifact', ref }));
  const observations = [
    observation(
      'inspect_decision_intelligence-1',
      'decision',
      'available',
      'Decision intelligence is available.',
      [{ type: 'run', ref: { run_id: parsed.run_id, status: 'succeeded' } }, ...artifactGrounding],
    ),
  ];
  for (const [index, entity] of pack.priority_entities.slice(0, 4).entries()) {
    const evidence = await visibleEvidence(
      repository,
      authorized,
      parsed.run_id,
      entity.evidence_refs,
    );
    const metrics = await visibleMetrics(repository, authorized, parsed.run_id, entity.metric_refs);
    observations.push(
      observation(
        `inspect_decision_intelligence-${index + 2}`,
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
    );
  }
  const actions: AvailableWorkspaceActionV1[] = authorized.active_report
    ? [
        {
          action_id: 'inspect-decision-open-dashboard',
          action: {
            type: 'open_dashboard',
            run_id: parsed.run_id,
            report_id: authorized.active_report.report_id,
          },
        },
      ]
    : [];
  return capabilityResult('inspect_decision_intelligence', 'available', observations, {
    available_workspace_actions: actions,
  });
}

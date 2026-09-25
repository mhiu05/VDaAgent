import { InspectVisualCapabilityInputSchema } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { CapabilityRegistryError, type RuntimeCapabilityExecutionContext } from './contracts';
import {
  unavailable,
  visibleMetrics,
  boundedGroundingRefs,
  artifactRef,
  boundedCanonicalText,
  capabilityResult,
  observation,
} from './projection';

export async function inspectVisual(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = InspectVisualCapabilityInputSchema.parse(input);
  const authorized = context.authorized_context;
  if (
    !authorized.active_chart ||
    authorized.active_chart.run_id !== parsed.run_id ||
    authorized.active_chart.chart_id !== parsed.chart_id
  )
    throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const decision = await repository.decisionIntelligence(
    authorized.actor.user_id,
    authorized.org_id,
    parsed.run_id,
  );
  if (decision.status !== 'available') return unavailable('inspect_visual', 'inspect_visual-1');
  const chartPack = await repository.publicArtifactById(
    authorized.actor.user_id,
    authorized.org_id,
    parsed.run_id,
    decision.decision_intelligence.chart_pack_artifact_id,
  );
  if (chartPack.kind !== 'chart_pack') return unavailable('inspect_visual', 'inspect_visual-1');
  const chart = chartPack.payload.charts.find((item) => item.chart_id === parsed.chart_id);
  if (!chart) return unavailable('inspect_visual', 'inspect_visual-1');
  const metrics = await visibleMetrics(
    repository,
    authorized,
    parsed.run_id,
    chart.provenance.bindings.map((binding) => ({
      artifact_id: binding.artifact_id,
      metric_key: binding.metric_key,
      path: binding.evidence_path,
    })),
  );
  const grounding = boundedGroundingRefs([
    { type: 'run', ref: { run_id: parsed.run_id, status: 'succeeded' } },
    { type: 'artifact', ref: artifactRef(chartPack) },
    ...metrics.map((ref) => ({ type: 'metric', ref })),
  ]);
  const measure = chart.provenance.metric_keys.slice(0, 6).join(', ');
  const purpose = boundedCanonicalText(chart.purpose, 'Validated chart comparison is available.');
  return capabilityResult(
    'inspect_visual',
    'available',
    [
      observation(
        'inspect_visual-title',
        'metric',
        'available',
        boundedCanonicalText(chart.title, 'Validated chart title is available.'),
        grounding,
      ),
      observation(
        'inspect_visual-measure',
        'metric',
        'available',
        measure ? `Chart measure: ${measure}.` : 'Validated chart measure is available.',
        grounding,
        { display_value: chart.y_axis?.unit ?? null },
      ),
      observation(
        'inspect_visual-comparison',
        'decision',
        'available',
        `Chart intent: ${chart.intent}. ${purpose}`,
        grounding,
      ),
      observation(
        'inspect_visual-provenance',
        'status',
        'available',
        `Chart provenance includes ${chart.provenance.bindings.length} validated binding(s).`,
        grounding,
      ),
    ],
    {
      available_workspace_actions: [
        {
          action_id: 'inspect-visual-focus',
          action: { type: 'focus_visual', run_id: parsed.run_id, chart_id: parsed.chart_id },
        },
      ],
    },
  );
}

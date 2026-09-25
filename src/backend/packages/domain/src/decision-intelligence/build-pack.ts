import {
  ActionCandidateSchema,
  type CanonicalEvidenceRef,
  type CanonicalMetricRef,
  type MaterialChange,
  type PriorityEntity,
  type PriorityEntityType,
} from '@vda/contracts/decision/intelligence';
import {
  DecisionIntelligencePackSchema,
  type DecisionIntelligencePack,
} from '@vda/contracts/agents/workflow-packs';
import type { AnalysisRun } from '@vda/contracts/analysis/run';
import type { Artifact, ArtifactOf } from '@vda/contracts/artifacts/artifact';
import type { DecisionBrief } from '@vda/contracts/decision/brief';
import type { DecisionUseCasePolicy } from '@vda/contracts/agents/use-case';
import type { MetricKey, MetricUnit } from '@vda/contracts/analysis/metrics';
import { buildDecisionBrief } from '@vda/semantic/decisions/build-decision-brief';
import { canonical, readArtifactPath, stableId, verifyArtifact } from '../artifacts/integrity';

export class DecisionIntelligenceError extends Error {
  constructor(
    readonly code:
      | 'DECISION_INPUT_INVALID'
      | 'DECISION_POLICY_INVALID'
      | 'DECISION_PACK_INVALID'
      | 'CROSS_RUN_DECISION_REFERENCE',
  ) {
    super(code);
  }
}

export type DecisionIntelligenceInput = {
  run: AnalysisRun;
  data_analysis_pack: ArtifactOf<'data_analysis_pack'>;
  calculation: ArtifactOf<'calculation'>;
  comparison: ArtifactOf<'comparison'>;
  comparison_pack: ArtifactOf<'comparison_pack'>;
  visual_evidence: ArtifactOf<'visual_evidence'>;
  chart_pack: ArtifactOf<'chart_pack'>;
  analysis_pack: ArtifactOf<'analysis_pack'>;
  insight_pack: ArtifactOf<'insight_pack'>;
  policy: DecisionUseCasePolicy;
  artifact_keys?: Partial<Record<Artifact['kind'], string>>;
};

type ResolvedInput = DecisionIntelligenceInput & {
  keys: Record<string, string>;
};

const requiredKpis: readonly MetricKey[] = [
  'available_inventory',
  'slow_moving_units',
  'slow_moving_rate',
  'median_inventory_age_days',
];

function unique<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

function numberValue(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}

export function resolved(input: DecisionIntelligenceInput): ResolvedInput {
  const artifacts = [
    input.data_analysis_pack,
    input.calculation,
    input.comparison,
    input.comparison_pack,
    input.visual_evidence,
    input.chart_pack,
    input.analysis_pack,
    input.insight_pack,
  ];
  for (const artifact of artifacts) verifyArtifact(artifact);
  const data = input.data_analysis_pack.payload;
  if (
    artifacts.some(
      (artifact) =>
        artifact.org_id !== input.run.org_id ||
        artifact.run_id !== input.run.run_id ||
        artifact.data_as_of !== input.run.request.data_as_of ||
        artifact.semantic_version !== input.calculation.semantic_version,
    ) ||
    input.run.request.use_case !== data.use_case ||
    canonical(input.run.request.scope) !== canonical(data.scope) ||
    data.dataset.calculation_artifact_id !== input.calculation.artifact_id ||
    data.dataset.comparison_artifact_id !== input.comparison.artifact_id ||
    input.comparison_pack.payload.data_analysis_pack_artifact_id !==
      input.data_analysis_pack.artifact_id ||
    input.chart_pack.payload.data_analysis_pack_artifact_id !==
      input.data_analysis_pack.artifact_id ||
    input.analysis_pack.payload.data_analysis_pack_artifact_id !==
      input.data_analysis_pack.artifact_id ||
    input.insight_pack.payload.data_analysis_pack_artifact_id !==
      input.data_analysis_pack.artifact_id ||
    input.insight_pack.payload.comparison_pack_artifact_id !== input.comparison_pack.artifact_id ||
    input.insight_pack.payload.chart_pack_artifact_id !== input.chart_pack.artifact_id ||
    input.insight_pack.payload.analysis_pack_artifact_id !== input.analysis_pack.artifact_id
  )
    throw new DecisionIntelligenceError('DECISION_INPUT_INVALID');
  if (!input.policy.materiality.length || input.policy.visualization.primary_cap > 3)
    throw new DecisionIntelligenceError('DECISION_POLICY_INVALID');
  return {
    ...input,
    keys: {
      data_analysis_pack: input.artifact_keys?.data_analysis_pack ?? 'data_analysis_pack',
      calculation: input.artifact_keys?.calculation ?? 'data.calculation',
      comparison: input.artifact_keys?.comparison ?? 'data.comparison',
      comparison_pack: input.artifact_keys?.comparison_pack ?? 'comparison_pack',
      visual_evidence: input.artifact_keys?.visual_evidence ?? 'chart.visual_evidence',
      chart_pack: input.artifact_keys?.chart_pack ?? 'chart_pack',
      analysis_pack: input.artifact_keys?.analysis_pack ?? 'analysis_pack',
      insight_pack: input.artifact_keys?.insight_pack ?? 'insight_pack',
    },
  };
}

function evidence(artifact: Artifact, artifactKey: string, path: string): CanonicalEvidenceRef {
  try {
    readArtifactPath(artifact, path);
  } catch {
    throw new DecisionIntelligenceError('DECISION_INPUT_INVALID');
  }
  return { artifact_id: artifact.artifact_id, artifact_key: artifactKey, path };
}

function metricRef(
  artifact: ArtifactOf<'calculation'>,
  key: string,
  metricKey: MetricKey,
  path: string,
): CanonicalMetricRef {
  const ref = evidence(artifact, key, path);
  return { ...ref, metric_key: metricKey };
}

function allEvidence(...groups: CanonicalEvidenceRef[][]): CanonicalEvidenceRef[] {
  return unique(groups.flat(), (ref) => `${ref.artifact_id}:${ref.artifact_key}:${ref.path}`).sort(
    (left, right) =>
      `${left.artifact_id}:${left.artifact_key}:${left.path}`.localeCompare(
        `${right.artifact_id}:${right.artifact_key}:${right.path}`,
      ),
  );
}

function deltaUnit(unit: MetricUnit): MetricUnit {
  return unit === 'percent' ? 'percentage_points' : unit;
}

function changes(input: ResolvedInput): MaterialChange[] {
  const calculation = input.calculation;
  const out: MaterialChange[] = [];
  for (const rule of input.policy.materiality) {
    for (const [index, comparison] of calculation.payload.period_comparisons.entries()) {
      if (comparison.metric_key !== rule.metric_key || comparison.abstention_reason !== null)
        continue;
      const current = numberValue(comparison.current_value);
      const prior = numberValue(comparison.comparison_value);
      const absolute = numberValue(comparison.absolute_delta);
      const thresholdValue =
        rule.delta_kind === 'relative_pct'
          ? numberValue(comparison.relative_delta_pct)
          : numberValue(comparison.percentage_point_delta);
      if (current === null || prior === null || absolute === null || thresholdValue === null)
        continue;
      const magnitude = Math.abs(thresholdValue);
      if (magnitude < rule.watch_threshold) continue;
      const metric = calculation.payload.metrics.find(
        (candidate) => candidate.key === rule.metric_key,
      );
      if (!metric) throw new DecisionIntelligenceError('DECISION_INPUT_INVALID');
      const severity = magnitude >= rule.material_threshold ? 'material' : 'watch';
      const direction =
        rule.direction === 'context_only'
          ? 'context_only'
          : absolute > 0 === (rule.direction === 'higher_is_worse')
            ? 'deteriorating'
            : 'improving';
      const base = `payload.period_comparisons[${index}]`;
      const refs = [
        metricRef(calculation, input.keys.calculation, rule.metric_key, `${base}.current_value`),
        metricRef(calculation, input.keys.calculation, rule.metric_key, `${base}.comparison_value`),
      ];
      out.push({
        change_id: `change:${normalize(rule.rule_id)}:${comparison.period_days}`,
        rule_id: rule.rule_id,
        metric_key: rule.metric_key,
        period_days: comparison.period_days,
        current_value: comparison.current_value!,
        comparison_value: comparison.comparison_value!,
        delta: comparison.absolute_delta!,
        delta_unit: deltaUnit(metric.unit),
        unit: metric.unit,
        direction,
        severity,
        comparable: true,
        metric_refs: refs,
        evidence_refs: refs.map(({ metric_key: _metricKey, ...ref }) => ref),
        limitations: [],
      });
    }
  }
  return out.sort(
    (left, right) =>
      (right.severity === 'material' ? 1 : 0) - (left.severity === 'material' ? 1 : 0) ||
      left.period_days - right.period_days ||
      left.rule_id.localeCompare(right.rule_id),
  );
}

function businessStatus(changes: readonly MaterialChange[], hasComparableInput: boolean) {
  const material = changes.filter((change) => change.severity === 'material');
  const deteriorating = material.some((change) => change.direction === 'deteriorating');
  const improving = material.some((change) => change.direction === 'improving');
  if (deteriorating && improving) return 'mixed' as const;
  if (deteriorating) return 'deteriorating' as const;
  if (improving) return 'improving' as const;
  return hasComparableInput ? ('stable' as const) : ('insufficient_evidence' as const);
}

function hotspots(input: ResolvedInput) {
  const output: Array<{
    hotspot_id: string;
    entity: { type: PriorityEntityType; key: string; label: string };
    metric_key: MetricKey;
    value: string | number;
    unit: MetricUnit;
    metric_ref: CanonicalMetricRef;
    evidence_refs: CanonicalEvidenceRef[];
    limitations: string[];
  }> = [];
  const supported = new Set<PriorityEntityType>(input.policy.priority.entity_types);
  for (const [breakdownIndex, breakdown] of input.calculation.payload.breakdowns.entries()) {
    if (
      !supported.has(breakdown.dimension) ||
      (breakdown.dimension !== 'zone' && breakdown.dimension !== 'unit_type')
    )
      continue;
    const metric = input.calculation.payload.metrics.find(
      (candidate) => candidate.key === breakdown.metric_key,
    );
    if (!metric) continue;
    for (const [itemIndex, item] of breakdown.items.entries()) {
      if (item.value === null || item.abstention_reason !== null) continue;
      const path = `payload.breakdowns[${breakdownIndex}].items[${itemIndex}].value`;
      const ref = metricRef(input.calculation, input.keys.calculation, breakdown.metric_key, path);
      output.push({
        hotspot_id: `hotspot:${breakdown.dimension}:${normalize(item.key)}:${breakdown.metric_key}`,
        entity: { type: breakdown.dimension, key: item.key, label: item.label },
        metric_key: breakdown.metric_key,
        value: item.value,
        unit: metric.unit,
        metric_ref: ref,
        evidence_refs: [
          { artifact_id: ref.artifact_id, artifact_key: ref.artifact_key, path: ref.path },
        ],
        limitations: [...breakdown.limitations],
      });
    }
  }
  return output
    .sort(
      (left, right) =>
        (numberValue(right.value) ?? -Infinity) - (numberValue(left.value) ?? -Infinity) ||
        left.entity.type.localeCompare(right.entity.type) ||
        left.entity.key.localeCompare(right.entity.key),
    )
    .slice(0, input.policy.priority.max_segments);
}

function unitTier(
  unit: ArtifactOf<'data_analysis_pack'>['payload']['units'][number],
): PriorityEntity['tier'] {
  if ((unit.age_days ?? 0) > 180) return 'critical';
  if (unit.slow_moving) return 'high';
  if ((unit.age_days ?? 0) > 90) return 'medium';
  return 'watch';
}

function prioritise(input: ResolvedInput, hot: ReturnType<typeof hotspots>): PriorityEntity[] {
  const unitEntries = input.data_analysis_pack.payload.units
    .map((unit, index) => ({ unit, index }))
    .filter(
      ({ unit }) =>
        unit.status === 'available' && input.policy.priority.entity_types.includes('unit'),
    )
    .sort(
      (left, right) =>
        Number(Boolean(right.unit.slow_moving)) - Number(Boolean(left.unit.slow_moving)) ||
        (right.unit.age_days ?? -1) - (left.unit.age_days ?? -1) ||
        left.unit.unit_external_id.localeCompare(right.unit.unit_external_id),
    )
    .slice(0, input.policy.priority.max_units);
  const entities: PriorityEntity[] = unitEntries.map(({ unit, index }) => {
    const id = `priority:unit:${normalize(unit.unit_external_id)}`;
    const ageRef = metricRef(
      input.calculation,
      input.keys.calculation,
      'median_inventory_age_days',
      `payload.units[${index}].age_days`,
    );
    return {
      priority_entity_id: id,
      entity: { type: 'unit', key: unit.unit_external_id, label: unit.unit_code },
      rank: 0,
      tier: unitTier(unit),
      policy_rule_ids: ['available-unit-age-order-v1'],
      reason_codes: [
        unit.slow_moving ? 'slow_moving' : 'available_inventory',
        `age_${unitTier(unit)}`,
      ],
      metric_refs: [ageRef],
      evidence_refs: [
        { artifact_id: ageRef.artifact_id, artifact_key: ageRef.artifact_key, path: ageRef.path },
      ],
      support_level: 'high',
      action_candidate_ids: [`action:inspect:${normalize(id)}`],
      drilldown_ids: [`drilldown:inspect:${normalize(id)}`],
      limitations: [],
    };
  });
  const segmentEntries = hot
    .filter((item) => item.entity.type === 'zone' || item.entity.type === 'unit_type')
    .slice(0, input.policy.priority.max_segments)
    .map((item) => {
      const id = `priority:${item.entity.type}:${normalize(item.entity.key)}`;
      const isSegment = item.entity.type === 'zone' || item.entity.type === 'unit_type';
      return {
        priority_entity_id: id,
        entity: item.entity,
        rank: 0,
        tier: 'high' as const,
        policy_rule_ids: ['segment-concentration-order-v1'],
        reason_codes: ['concentration', item.metric_key],
        metric_refs: [item.metric_ref],
        evidence_refs: item.evidence_refs,
        support_level: 'high' as const,
        action_candidate_ids: [
          `action:inspect:${normalize(id)}`,
          ...(isSegment ? [`action:compare:${normalize(id)}`] : []),
        ],
        drilldown_ids: [
          `drilldown:inspect:${normalize(id)}`,
          ...(isSegment ? [`drilldown:compare:${normalize(id)}`] : []),
        ],
        limitations: item.limitations,
      };
    });
  return [...entities, ...segmentEntries]
    .slice(0, input.policy.priority.max_total)
    .map((entity, index) => ({ ...entity, rank: index + 1 }));
}

function visualStory(input: ResolvedInput, limitations: string[]) {
  const selected: Array<{
    chart_id: string;
    role: 'primary' | 'supporting';
    display_priority: number;
    reason: string;
  }> = [];
  for (const intent of input.policy.visualization.preferred_intents) {
    const chart = input.visual_evidence.payload.charts.find(
      (candidate) => candidate.intent === intent,
    );
    if (!chart || selected.some((candidate) => candidate.chart_id === chart.chart_id)) continue;
    const needsComparison = input.policy.visualization.comparison_required_intents.includes(intent);
    if (needsComparison && chart.chart_type === 'line' && chart.data.length < 2) continue;
    const role =
      selected.filter((item) => item.role === 'primary').length <
      input.policy.visualization.primary_cap
        ? 'primary'
        : 'supporting';
    selected.push({
      chart_id: chart.chart_id,
      role,
      display_priority: selected.length + 1,
      reason: `Selected ${intent} visual from the pinned visualization policy.`,
    });
  }
  return {
    version: 'visual-story-v1' as const,
    headline: selected.length
      ? 'Current inventory, movement, and concentration visuals are ordered for review.'
      : 'No supported decision visual is available for this run.',
    ordered_visuals: selected,
    primary_visual_ids: selected
      .filter((item) => item.role === 'primary')
      .map((item) => item.chart_id),
    supporting_visual_ids: selected
      .filter((item) => item.role === 'supporting')
      .map((item) => item.chart_id),
    limitations,
  };
}

function actionsAndDrilldowns(
  input: ResolvedInput,
  entities: PriorityEntity[],
  fallbackEvidence: CanonicalEvidenceRef[],
) {
  const context = {
    run_id: input.run.run_id,
    org_id: input.run.org_id,
    use_case: input.run.request.use_case,
    use_case_version: input.data_analysis_pack.payload.use_case_version,
    scope: input.run.request.scope,
    requested_data_as_of: input.run.request.data_as_of,
    effective_snapshot_date: input.calculation.payload.current_snapshot_date,
    semantic_version: input.calculation.semantic_version,
    snapshot_refs: [...input.calculation.snapshot_refs].sort(),
  };
  const inspectPolicy = input.policy.actions.find((policy) => policy.kind === 'inspect_entities');
  const comparePolicy = input.policy.actions.find((policy) => policy.kind === 'compare_segments');
  const evidencePolicy = input.policy.actions.find(
    (policy) => policy.kind === 'navigate_to_evidence',
  );
  if (!inspectPolicy || !comparePolicy || !evidencePolicy)
    throw new DecisionIntelligenceError('DECISION_POLICY_INVALID');
  const drilldowns: DecisionIntelligencePack['drilldowns'] = [];
  const actions: DecisionIntelligencePack['action_candidates'] = [];
  for (const entity of entities) {
    const inspectId = `drilldown:inspect:${normalize(entity.priority_entity_id)}`;
    drilldowns.push({
      drilldown_id: inspectId,
      kind: 'inspect_entities',
      label: `Inspect ${entity.entity.label}`,
      context,
      entity_refs: [entity.entity],
      filters:
        entity.entity.type === 'unit'
          ? [{ dimension: 'status', operator: 'equals', value: 'available' }]
          : [{ dimension: entity.entity.type, operator: 'equals', value: entity.entity.key }],
    });
    actions.push(
      ActionCandidateSchema.parse({
        action_candidate_id: `action:inspect:${normalize(entity.priority_entity_id)}`,
        kind: 'inspect_entities',
        label: `Inspect ${entity.entity.label}`,
        rationale: 'Review the evidence-backed entity before choosing a business response.',
        policy_rule_id: inspectPolicy.rule_id,
        support_level: 'high',
        target_entity_ids: [entity.priority_entity_id],
        target_signal_ids: [],
        drilldown_id: inspectId,
        evidence_refs: entity.evidence_refs,
        limitations: entity.limitations,
      }),
    );
    if (entity.entity.type === 'zone' || entity.entity.type === 'unit_type') {
      const compareId = `drilldown:compare:${normalize(entity.priority_entity_id)}`;
      drilldowns.push({
        drilldown_id: compareId,
        kind: 'compare_segment',
        label: `Compare ${entity.entity.label}`,
        context,
        dimension: entity.entity.type,
        segment_key: entity.entity.key,
      });
      actions.push(
        ActionCandidateSchema.parse({
          action_candidate_id: `action:compare:${normalize(entity.priority_entity_id)}`,
          kind: 'compare_segments',
          label: `Compare ${entity.entity.label}`,
          rationale: 'Compare this segment within the same validated run and scope.',
          policy_rule_id: comparePolicy.rule_id,
          support_level: 'high',
          target_entity_ids: [entity.priority_entity_id],
          target_signal_ids: [],
          drilldown_id: compareId,
          evidence_refs: entity.evidence_refs,
          limitations: entity.limitations,
        }),
      );
    }
  }
  const evidenceId = 'drilldown:decision-evidence';
  drilldowns.push({
    drilldown_id: evidenceId,
    kind: 'open_evidence',
    label: 'Open decision evidence',
    context,
    evidence_refs: fallbackEvidence,
  });
  actions.push(
    ActionCandidateSchema.parse({
      action_candidate_id: 'action:open-decision-evidence',
      kind: 'navigate_to_evidence',
      label: 'Open decision evidence',
      rationale: 'Review the same-run canonical evidence and stated limitations.',
      policy_rule_id: evidencePolicy.rule_id,
      support_level: 'high',
      target_entity_ids: [],
      target_signal_ids: [],
      drilldown_id: evidenceId,
      evidence_refs: fallbackEvidence,
      limitations: [],
    }),
  );
  return { actions, drilldowns };
}

/** Builds the canonical decision handoff without a provider, repository, clock, or warehouse read. */
export function buildDecisionIntelligencePack(
  input: DecisionIntelligenceInput,
): DecisionIntelligencePack {
  const source = resolved(input);
  const calculation = source.calculation;
  const kpiCards = requiredKpis.flatMap((metricKey) => {
    const index = calculation.payload.metrics.findIndex((metric) => metric.key === metricKey);
    if (index < 0) return [];
    const metric = calculation.payload.metrics[index];
    const ref = metricRef(
      calculation,
      source.keys.calculation,
      metric.key,
      `payload.metrics[${index}].value`,
    );
    return [
      {
        kpi_id: `kpi:${metric.key}`,
        label: metric.label,
        metric_key: metric.key,
        value: metric.value,
        unit: metric.unit,
        currency: metric.currency,
        status: metric.status,
        metric_ref: ref,
        limitations: metric.status === 'unavailable' ? calculation.payload.quality_limitations : [],
      },
    ];
  });
  const materialChanges = changes(source);
  const comparable = calculation.payload.period_comparisons.some(
    (comparison) =>
      comparison.current_value !== null &&
      comparison.comparison_value !== null &&
      comparison.abstention_reason === null,
  );
  const hot = hotspots(source);
  const priorityEntities = prioritise(source, hot);
  const qualityEvidence = evidence(
    calculation,
    source.keys.calculation,
    'payload.quality_limitations',
  );
  const metricEvidence = kpiCards.map(({ metric_ref: { metric_key: _key, ...ref } }) => ref);
  const decisionEvidence = allEvidence(
    metricEvidence,
    materialChanges.flatMap((change) => change.evidence_refs),
    hot.flatMap((hotspot) => hotspot.evidence_refs),
    [qualityEvidence],
  );
  const limitations = unique(
    [...calculation.limitations, ...calculation.payload.quality_limitations].filter(Boolean),
    (value) => value,
  ).sort();
  const story = visualStory(source, limitations);
  const { actions, drilldowns } = actionsAndDrilldowns(source, priorityEntities, decisionEvidence);
  const implications = hot.slice(0, 3).map((hotspot) => ({
    implication_id: `implication:${normalize(hotspot.hotspot_id)}`,
    kind: 'descriptive' as const,
    support_level: 'high' as const,
    template_id: 'inspect-concentrated-entity-v1',
    text: `${hotspot.entity.label} is a supported concentration; inspect its contributing units.`,
    evidence_refs: hotspot.evidence_refs,
    limitations: hotspot.limitations,
  }));
  const handoff = {
    completeness: comparable ? ('complete' as const) : ('partial' as const),
    available_components: [
      'data_analysis_pack',
      'comparison_pack',
      'chart_pack',
      'analysis_pack',
      'insight_pack',
    ],
    missing_components: [],
    optional_inputs_present: source.comparison.payload.items.length
      ? ['peer_price_comparison']
      : [],
    optional_inputs_missing: source.comparison.payload.items.length
      ? ['demand', 'sales_activity']
      : ['peer_price_comparison', 'demand', 'sales_activity'],
  };
  const status = businessStatus(materialChanges, comparable);
  const primarySignal = materialChanges[0];
  const headline = primarySignal
    ? `${primarySignal.metric_key} is ${primarySignal.direction} over ${primarySignal.period_days} days.`
    : status === 'insufficient_evidence'
      ? 'Comparable movement is unavailable; review current-state evidence and limitations.'
      : 'No policy-material movement is present in the comparable inventory evidence.';
  return DecisionIntelligencePackSchema.parse({
    contract_version: 'decision-intelligence-pack-v1',
    pack_id: stableId(`${source.run.run_id}:decision-intelligence-pack`),
    run_id: source.run.run_id,
    org_id: source.run.org_id,
    use_case: source.run.request.use_case,
    use_case_version: source.data_analysis_pack.payload.use_case_version,
    scope: source.run.request.scope,
    data_as_of: source.run.request.data_as_of,
    requested_data_as_of: source.run.request.data_as_of,
    effective_snapshot_date: calculation.payload.current_snapshot_date,
    semantic_version: calculation.semantic_version,
    input_refs: [
      source.data_analysis_pack.artifact_id,
      source.comparison_pack.artifact_id,
      source.chart_pack.artifact_id,
      source.analysis_pack.artifact_id,
      source.insight_pack.artifact_id,
    ].sort(),
    snapshot_refs: [...calculation.snapshot_refs].sort(),
    source_refs: [...calculation.source_refs].sort(),
    limitations,
    data_analysis_pack_artifact_id: source.data_analysis_pack.artifact_id,
    comparison_pack_artifact_id: source.comparison_pack.artifact_id,
    chart_pack_artifact_id: source.chart_pack.artifact_id,
    analysis_pack_artifact_id: source.analysis_pack.artifact_id,
    insight_pack_artifact_id: source.insight_pack.artifact_id,
    decision_brief: {
      version: 'decision-brief-v2',
      headline,
      status,
      scope: source.run.request.scope,
      requested_data_as_of: source.run.request.data_as_of,
      effective_snapshot_date: calculation.payload.current_snapshot_date,
      semantic_version: calculation.semantic_version,
      kpi_cards: kpiCards,
      material_changes: materialChanges,
      hotspots: hot,
      business_implications: implications,
      watchouts: limitations.map((limitation, index) => ({
        watchout_id: `watchout:${index + 1}`,
        label: 'Data limitation',
        reason: limitation,
        evidence_refs: [qualityEvidence],
      })),
      data_quality_summary: {
        status: limitations.length ? 'limited' : 'available',
        limitations,
        evidence_refs: [qualityEvidence],
      },
      primary_visual_ids: story.primary_visual_ids,
      priority_entity_ids: priorityEntities.map((entity) => entity.priority_entity_id),
      action_candidate_ids: actions.map((action) => action.action_candidate_id),
      drilldown_ids: drilldowns.map((drilldown) => drilldown.drilldown_id),
      evidence_refs: decisionEvidence,
      limitations,
    },
    visual_story: story,
    priority_entities: priorityEntities,
    action_candidates: actions,
    drilldowns,
    handoff,
    evidence_refs: decisionEvidence,
  });
}

/** Uses the established serializer exactly; v2 never changes the legacy brief wire shape. */
export function projectDecisionBriefV1Compatibility(
  input: DecisionIntelligenceInput,
): DecisionBrief {
  const source = resolved(input);
  return buildDecisionBrief(
    source.calculation.payload,
    source.calculation.artifact_id,
    source.run.request.scope,
    source.run.request.data_as_of,
  );
}

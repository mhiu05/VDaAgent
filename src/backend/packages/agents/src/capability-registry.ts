import {
  CapabilityInvocationSchema,
  CapabilityResultV1Schema,
  CreateAnalysisCapabilityInputSchema,
  GetAnalysisResultCapabilityInputSchema,
  GetReportContextCapabilityInputSchema,
  InspectAgentCheckpointCapabilityInputSchema,
  InspectDecisionIntelligenceCapabilityInputSchema,
  InspectEvidenceCapabilityInputSchema,
  InspectPriorityEntityCapabilityInputSchema,
  InspectSignalCapabilityInputSchema,
  InspectVisualCapabilityInputSchema,
  type AgentCapabilityIdV1,
  type Artifact,
  type ArtifactReference,
  type AvailableWorkspaceActionV1,
  type CanonicalMetricRef,
  type CapabilityInvocation,
  type CapabilityResultV1,
  type EvidenceRefV1,
  type Role,
  type RunReference,
  type WorkspaceModeV1,
} from '@vda/contracts';
import { RepositoryError, type Repository, type TurnContext } from '@vda/db';
import { readArtifactPath } from '@vda/domain';
import {
  AGENT_RUNTIME_LIMITS,
  MAX_AGENT_CAPABILITY_CALLS,
  MAX_AGENT_GROUNDING_REFS_PER_OBSERVATION,
  MAX_AGENT_MUTATING_CAPABILITY_CALLS,
  MAX_AGENT_NEW_ANALYSIS_RUNS,
} from './runtime-limits';
import type { AuthorizedAgentContextV1 } from './runtime-context';
import {
  createAnalysisTool,
  getAgentTargetFollowUp,
  type AgentToolExecutionContext,
} from './tools';

type InputParser = { parse(input: unknown): unknown };
type RequiredContext =
  | 'run'
  | 'signal'
  | 'decision'
  | 'evidence'
  | 'report'
  | 'chart'
  | 'priority_entity'
  | 'agent_target'
  | 'catalog';

export type CapabilityDescriptor = {
  id: AgentCapabilityIdV1;
  version: 'v1';
  activity_label:
    | 'inspecting_context'
    | 'starting_analysis'
    | 'analysis_queued'
    | 'preparing_answer';
  kind: 'read' | 'mutation';
  allowed_roles: readonly Role[];
  allowed_modes: readonly WorkspaceModeV1[];
  required_context: readonly RequiredContext[];
  max_calls_per_turn: number;
  creates_run: boolean;
  input_schema: InputParser;
  execute: (
    context: RuntimeCapabilityExecutionContext,
    input: unknown,
  ) => Promise<CapabilityResultV1>;
};

export type RuntimeCapabilityExecutionContext = {
  authorized_context: AuthorizedAgentContextV1;
  turn_context: TurnContext;
  idempotency_key: string;
};

export type CapabilityExecutionBudget = {
  total_calls: number;
  mutation_calls: number;
  new_analysis_runs: number;
  calls_by_capability: Map<AgentCapabilityIdV1, number>;
};

export class CapabilityRegistryError extends Error {
  constructor(
    readonly code:
      | 'CAPABILITY_DENIED'
      | 'CAPABILITY_UNAVAILABLE'
      | 'CAPABILITY_OUTPUT_INVALID'
      | 'RUNTIME_LIMIT_EXCEEDED',
  ) {
    super(code);
  }
}

const allRoles: readonly Role[] = ['owner', 'analyst', 'viewer'];
const writeRoles: readonly Role[] = ['owner', 'analyst'];
const bothModes: readonly WorkspaceModeV1[] = ['agent_chat', 'report_dashboard'];

function runRef(run: { run_id: string; status: RunReference['status'] }): RunReference {
  return { run_id: run.run_id, status: run.status };
}

function artifactRef(artifact: Artifact): ArtifactReference {
  return { run_id: artifact.run_id, artifact_id: artifact.artifact_id, kind: artifact.kind };
}

function boundedCanonicalText(value: string, fallback: string, maxLength = 900) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : fallback;
}

function canonicalEvidenceValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof serialized !== 'string') return null;
  const normalized = serialized.trim();
  return normalized.length > 0 && normalized.length <= 240 ? normalized : null;
}

function evidenceRefs(runId: string, values: readonly { artifact_id: string; path: string }[]) {
  return values.slice(0, MAX_AGENT_GROUNDING_REFS_PER_OBSERVATION).map((value) => ({
    run_id: runId,
    artifact_id: value.artifact_id,
    evidence_path: value.path,
  }));
}

/** Preserve deterministic order while ensuring every canonical observation
 * stays parseable even when an artifact has a high-cardinality evidence set. */
function boundedGroundingRefs(values: readonly unknown[]) {
  return values.slice(0, MAX_AGENT_GROUNDING_REFS_PER_OBSERVATION);
}

type MetricReferenceSource = Pick<CanonicalMetricRef, 'artifact_id' | 'path' | 'metric_key'>;

function metricRefs(runId: string, values: readonly MetricReferenceSource[]) {
  return values.slice(0, MAX_AGENT_GROUNDING_REFS_PER_OBSERVATION).map((value) => ({
    run_id: runId,
    artifact_id: value.artifact_id,
    metric_key: value.metric_key,
    evidence_path: value.path,
  }));
}

function observation(
  id: string,
  kind: 'claim' | 'metric' | 'decision' | 'status' | 'limitation',
  availability: 'available' | 'unavailable' | 'pending' | 'failed',
  canonicalText: string,
  groundingRefs: unknown[],
  options: { display_value?: string | null; support_level?: 'high' | 'medium' | 'limited' | 'exploratory' | null } = {},
) {
  return {
    observation_id: id,
    kind,
    availability,
    canonical_text: canonicalText,
    display_value: options.display_value ?? null,
    support_level: options.support_level ?? null,
    grounding_refs: groundingRefs,
  };
}

function capabilityResult(
  capabilityId: AgentCapabilityIdV1,
  status: CapabilityResultV1['status'],
  observations: unknown[],
  values: {
    available_workspace_actions?: AvailableWorkspaceActionV1[];
    queued_run_ref?: RunReference | null;
    error_code?: CapabilityResultV1['error_code'];
  } = {},
) {
  try {
    return CapabilityResultV1Schema.parse({
      version: 'capability-result-v1',
      capability_id: capabilityId,
      status,
      observations,
      available_workspace_actions: values.available_workspace_actions ?? [],
      queued_run_ref: values.queued_run_ref ?? null,
      error_code: values.error_code ?? null,
    });
  } catch {
    throw new CapabilityRegistryError('CAPABILITY_OUTPUT_INVALID');
  }
}

function unavailable(
  capabilityId: AgentCapabilityIdV1,
  id: string,
  text = 'An authorized result is unavailable for this request.',
) {
  return capabilityResult(capabilityId, 'unavailable', [
    observation(id, 'limitation', 'unavailable', text, []),
  ], { error_code: 'CAPABILITY_UNAVAILABLE' });
}

/**
 * A read may fail after earlier reads have produced valid observations. Keep
 * that distinction explicit: this contains no error detail or factual claim,
 * so the runtime can render a safe partial response without exposing a raw
 * repository/provider failure. Mutations remain terminal instead.
 */
function safeReadFailure(capabilityId: AgentCapabilityIdV1) {
  return capabilityResult(
    capabilityId,
    'failed',
    [
      observation(
        `${capabilityId}-technical-failure`,
        'limitation',
        'failed',
        'A later authorized result could not be retrieved.',
        [],
      ),
    ],
    { error_code: 'CAPABILITY_UNAVAILABLE' },
  );
}

function requireAllowedRun(context: AuthorizedAgentContextV1, runId: string) {
  if (!context.allowed_run_ids.includes(runId)) throw new CapabilityRegistryError('CAPABILITY_DENIED');
}

function legacyToolContext(context: RuntimeCapabilityExecutionContext): AgentToolExecutionContext {
  const authorized = context.authorized_context;
  return {
    ...context.turn_context,
    user_id: authorized.actor.user_id,
    role: authorized.actor.role,
    question: authorized.request.text,
    scope: authorized.scope,
    data_as_of: authorized.data_as_of,
    use_case: authorized.request.use_case,
    agent_target: authorized.request.agent_target,
    signal_action: authorized.request.signal_action,
    idempotency_key: context.idempotency_key,
    allowed_run_ids: authorized.allowed_run_ids,
    allowed_conversation_run_ids: authorized.allowed_conversation_run_ids,
    allowed_signal_refs: authorized.allowed_signal_refs,
    allowed_scopes: authorized.allowed_scopes,
  };
}

async function visibleArtifacts(
  repository: Repository,
  context: AuthorizedAgentContextV1,
  runId: string,
  artifactIds: readonly string[],
) {
  const artifacts = await repository.publicArtifactsByIds(
    context.actor.user_id,
    context.org_id,
    runId,
    [...new Set(artifactIds)].slice(0, 12),
  );
  return artifacts.map(artifactRef);
}

async function visibleEvidence(
  repository: Repository,
  context: AuthorizedAgentContextV1,
  runId: string,
  values: readonly { artifact_id: string; path: string }[],
) {
  const candidates = values.filter((value) =>
    context.allowed_evidence_refs.some(
      (reference) =>
        reference.run_id === runId &&
        reference.artifact_id === value.artifact_id &&
        reference.evidence_path === value.path,
    ),
  );
  const visible = await visibleArtifacts(
    repository,
    context,
    runId,
    candidates.map((candidate) => candidate.artifact_id),
  );
  const visibleIds = new Set(visible.map((artifact) => artifact.artifact_id));
  return evidenceRefs(
    runId,
    candidates.filter((candidate) => visibleIds.has(candidate.artifact_id)),
  );
}

async function visibleMetrics(
  repository: Repository,
  context: AuthorizedAgentContextV1,
  runId: string,
  values: readonly MetricReferenceSource[],
) {
  const candidates = values.filter((value) =>
    context.allowed_evidence_refs.some(
      (reference) =>
        reference.run_id === runId &&
        reference.artifact_id === value.artifact_id &&
        reference.evidence_path === value.path,
    ),
  );
  const visible = await visibleArtifacts(
    repository,
    context,
    runId,
    candidates.map((candidate) => candidate.artifact_id),
  );
  const visibleIds = new Set(visible.map((artifact) => artifact.artifact_id));
  return metricRefs(runId, candidates.filter((candidate) => visibleIds.has(candidate.artifact_id)));
}

async function getAnalysisResult(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = GetAnalysisResultCapabilityInputSchema.parse(input);
  const authorized = context.authorized_context;
  requireAllowedRun(authorized, parsed.run_id);
  const run = await repository.getRun(authorized.actor.user_id, authorized.org_id, parsed.run_id);
  const state =
    run.run.status === 'succeeded'
      ? 'available'
      : run.run.status === 'queued' || run.run.status === 'running'
        ? 'pending'
        : 'unavailable';
  const text =
    state === 'available'
      ? 'Analysis result is available.'
      : state === 'pending'
        ? 'Analysis is pending.'
        : 'Analysis is unavailable.';
  return capabilityResult('get_analysis_result', state, [
    observation('get_analysis_result-1', 'status', state, text, [
      { type: 'run', ref: runRef(run.run) },
    ]),
  ], {
    queued_run_ref: state === 'pending' ? runRef(run.run) : null,
    error_code: state === 'unavailable' ? 'CAPABILITY_UNAVAILABLE' : null,
  });
}

async function inspectSignal(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = InspectSignalCapabilityInputSchema.parse(input);
  const authorized = context.authorized_context;
  if (
    !authorized.allowed_signal_refs.some(
      (item) => item.run_id === parsed.run_id && item.signal_id === parsed.signal_id,
    )
  )
    throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const brief = await repository.decisionBrief(authorized.actor.user_id, authorized.org_id, parsed.run_id);
  const signal = [
    ...brief.decision_brief.current_state,
    ...brief.decision_brief.material_changes,
    ...brief.decision_brief.where_to_look,
    ...brief.decision_brief.data_quality,
  ].find((item) => item.signal_id === parsed.signal_id);
  if (!signal) throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const refs = await visibleEvidence(repository, authorized, parsed.run_id, signal.evidence);
  const grounding = boundedGroundingRefs([
    { type: 'run', ref: { run_id: parsed.run_id, status: 'succeeded' } },
    ...refs.map((ref) => ({ type: 'evidence', ref })),
  ]);
  return capabilityResult(
    'inspect_signal',
    signal.status === 'available' ? 'available' : 'unavailable',
    [
      observation(
        'inspect_signal-1',
        'claim',
        signal.status === 'available' ? 'available' : 'unavailable',
        signal.label,
        grounding,
      ),
    ],
    signal.status === 'available' ? {} : { error_code: 'CAPABILITY_UNAVAILABLE' },
  );
}

async function inspectDecisionIntelligence(
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
    const evidence = await visibleEvidence(repository, authorized, parsed.run_id, entity.evidence_refs);
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

async function inspectVisual(
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
  const decision = await repository.decisionIntelligence(authorized.actor.user_id, authorized.org_id, parsed.run_id);
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
  return capabilityResult('inspect_visual', 'available', [
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
  ], {
    available_workspace_actions: [
      {
        action_id: 'inspect-visual-focus',
        action: { type: 'focus_visual', run_id: parsed.run_id, chart_id: parsed.chart_id },
      },
    ],
  });
}

async function inspectPriorityEntity(
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
  const decision = await repository.decisionIntelligence(authorized.actor.user_id, authorized.org_id, parsed.run_id);
  if (decision.status !== 'available')
    return unavailable('inspect_priority_entity', 'inspect_priority_entity-1');
  const entity = decision.decision_intelligence.priority_entities.find(
    (item) => item.priority_entity_id === parsed.priority_entity_id,
  );
  if (!entity) throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const metrics = await visibleMetrics(repository, authorized, parsed.run_id, entity.metric_refs);
  const evidence = await visibleEvidence(repository, authorized, parsed.run_id, entity.evidence_refs);
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
  return capabilityResult('inspect_priority_entity', 'available', [
    observation('inspect_priority_entity-1', 'decision', 'available', entity.entity.label, boundedGroundingRefs([
      { type: 'run', ref: { run_id: parsed.run_id, status: 'succeeded' } },
      ...metrics.map((ref) => ({ type: 'metric', ref })),
      ...evidence.map((ref) => ({ type: 'evidence', ref })),
    ]), { support_level: entity.support_level }),
  ], { available_workspace_actions: actions });
}

async function inspectEvidence(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = InspectEvidenceCapabilityInputSchema.parse(input);
  const authorized = context.authorized_context;
  if (
    !authorized.allowed_evidence_refs.some(
      (item) =>
        item.run_id === parsed.run_id &&
        item.artifact_id === parsed.artifact_id &&
        item.evidence_path === parsed.evidence_path,
    )
  )
    throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const artifact = await repository.publicArtifactById(
    authorized.actor.user_id,
    authorized.org_id,
    parsed.run_id,
    parsed.artifact_id,
  );
  const ref: EvidenceRefV1 = {
    run_id: parsed.run_id,
    artifact_id: parsed.artifact_id,
    evidence_path: parsed.evidence_path,
  };
  let evidenceValue: unknown;
  try {
    evidenceValue = readArtifactPath(artifact, parsed.evidence_path);
  } catch {
    return unavailable('inspect_evidence', 'inspect_evidence-unavailable');
  }
  const displayValue = canonicalEvidenceValue(evidenceValue);
  if (displayValue === null)
    return unavailable(
      'inspect_evidence',
      'inspect_evidence-unavailable',
      'The selected public evidence is unavailable in a bounded display form.',
    );
  return capabilityResult('inspect_evidence', 'available', [
    observation(
      'inspect_evidence-value',
      'metric',
      'available',
      `Public evidence at ${parsed.evidence_path}.`,
      [
        { type: 'run', ref: { run_id: parsed.run_id, status: 'succeeded' } },
        { type: 'artifact', ref: artifactRef(artifact) },
        { type: 'evidence', ref },
      ],
      { display_value: displayValue },
    ),
  ], {
    available_workspace_actions: [
      {
        action_id: 'inspect-evidence-open',
        action: {
          type: 'open_evidence',
          run_id: parsed.run_id,
          artifact_id: parsed.artifact_id,
          evidence_path: parsed.evidence_path,
        },
      },
    ],
  });
}

async function reportContext(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = GetReportContextCapabilityInputSchema.parse(input);
  const authorized = context.authorized_context;
  const report = authorized.allowed_report_refs.find(
    (item) => item.run_id === parsed.run_id && item.report_id === parsed.report_id,
  );
  if (!report) throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const record = await repository.getReport(authorized.actor.user_id, authorized.org_id, report.report_id);
  if (record.report.run_id !== report.run_id) throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const artifact = await repository.publicArtifactById(
    authorized.actor.user_id,
    authorized.org_id,
    report.run_id,
    record.report.artifact_id,
  );
  if (artifact.kind !== 'report') return unavailable('get_report_context', 'get_report_context-1');
  const grounding = [
    { type: 'run', ref: { run_id: report.run_id, status: 'succeeded' } },
    { type: 'artifact', ref: artifactRef(artifact) },
  ];
  const observations = [
    observation(
      'get_report_context-summary',
      'status',
      'available',
      boundedCanonicalText(artifact.payload.summary, 'Published report summary is available.', 1_100),
      grounding,
    ),
    ...artifact.payload.sections.slice(0, 8).map((section, index) =>
      observation(
        `get_report_context-section-${index + 1}`,
        section.status === 'unavailable' ? 'limitation' : 'status',
        section.status === 'available' ? 'available' : 'unavailable',
        `${boundedCanonicalText(section.title, section.key, 700)} is ${section.status}.`,
        grounding,
      ),
    ),
  ];
  return capabilityResult(
    'get_report_context',
    observations.some((item) => item.availability === 'available') ? 'available' : 'unavailable',
    observations,
    {
    available_workspace_actions: [
      {
        action_id: 'get-report-context-open-dashboard',
        action: { type: 'open_dashboard', run_id: report.run_id, report_id: report.report_id },
      },
    ],
      error_code: observations.some((item) => item.availability === 'available')
        ? null
        : 'CAPABILITY_UNAVAILABLE',
    },
  );
}

async function createAnalysis(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = CreateAnalysisCapabilityInputSchema.parse(input);
  const result = await createAnalysisTool(repository, legacyToolContext(context), {
    action: 'create_analysis',
    focus: parsed.focus ?? 'current_inventory',
  });
  if (result.kind !== 'created_analysis') throw new CapabilityRegistryError('CAPABILITY_UNAVAILABLE');
  const queued = runRef(result.run);
  return capabilityResult(
    'create_analysis',
    'pending',
    [
      observation('create_analysis-1', 'status', 'pending', 'Analysis queued.', [
        { type: 'run', ref: queued },
      ]),
    ],
    { queued_run_ref: queued },
  );
}

function groundingFromMessagePart(part: { type: string; [key: string]: unknown }) {
  if (part.type === 'run_ref')
    return [{ type: 'run', ref: { run_id: part.run_id, status: part.status } }];
  if (part.type === 'artifact_ref')
    return [
      {
        type: 'artifact',
        ref: { run_id: part.run_id, artifact_id: part.artifact_id, kind: part.kind },
      },
    ];
  if (part.type === 'claim_ref') return [{ type: 'claim', ref: part.ref }];
  if (part.type === 'metric_ref') return [{ type: 'metric', ref: part.ref }];
  if (part.type === 'evidence_ref') return [{ type: 'evidence', ref: part.ref }];
  if (part.type === 'quality_ref') return [{ type: 'quality', ref: part.ref }];
  return [];
}

async function inspectAgentCheckpoint(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = InspectAgentCheckpointCapabilityInputSchema.parse(input);
  if (context.authorized_context.request.agent_target !== parsed.agent_target)
    throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const result = await getAgentTargetFollowUp(repository, legacyToolContext(context));
  if (result.kind === 'agent_target_unavailable')
    return unavailable('inspect_agent_checkpoint', 'inspect_agent_checkpoint-1');
  const grounding = result.parts.flatMap((part) => groundingFromMessagePart(part));
  return capabilityResult('inspect_agent_checkpoint', 'available', [
    observation(
      'inspect_agent_checkpoint-1',
      'status',
      'available',
      result.content,
      boundedGroundingRefs(
        grounding.length ? grounding : [{ type: 'run', ref: runRef(result.run) }],
      ),
    ),
  ]);
}

export function createCapabilityExecutionBudget(): CapabilityExecutionBudget {
  return {
    total_calls: 0,
    mutation_calls: 0,
    new_analysis_runs: 0,
    calls_by_capability: new Map(),
  };
}

function defaultDescriptors(repository: Repository): CapabilityDescriptor[] {
  return [
    {
      id: 'create_analysis',
      version: 'v1',
      activity_label: 'starting_analysis',
      kind: 'mutation',
      allowed_roles: writeRoles,
      allowed_modes: bothModes,
      required_context: ['catalog'],
      max_calls_per_turn: 1,
      creates_run: true,
      input_schema: CreateAnalysisCapabilityInputSchema,
      execute: (context, input) => createAnalysis(repository, context, input),
    },
    {
      id: 'get_analysis_result',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: bothModes,
      required_context: ['run'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: GetAnalysisResultCapabilityInputSchema,
      execute: (context, input) => getAnalysisResult(repository, context, input),
    },
    {
      id: 'inspect_signal',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: bothModes,
      required_context: ['signal'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: InspectSignalCapabilityInputSchema,
      execute: (context, input) => inspectSignal(repository, context, input),
    },
    {
      id: 'inspect_decision_intelligence',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: bothModes,
      required_context: ['run', 'report', 'decision'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: InspectDecisionIntelligenceCapabilityInputSchema,
      execute: (context, input) => inspectDecisionIntelligence(repository, context, input),
    },
    {
      id: 'inspect_visual',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: ['report_dashboard'],
      required_context: ['chart'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: InspectVisualCapabilityInputSchema,
      execute: (context, input) => inspectVisual(repository, context, input),
    },
    {
      id: 'inspect_priority_entity',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: ['report_dashboard'],
      required_context: ['priority_entity'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: InspectPriorityEntityCapabilityInputSchema,
      execute: (context, input) => inspectPriorityEntity(repository, context, input),
    },
    {
      id: 'inspect_evidence',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: bothModes,
      required_context: ['evidence'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: InspectEvidenceCapabilityInputSchema,
      execute: (context, input) => inspectEvidence(repository, context, input),
    },
    {
      id: 'get_report_context',
      version: 'v1',
      activity_label: 'preparing_answer',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: bothModes,
      required_context: ['report'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: GetReportContextCapabilityInputSchema,
      execute: (context, input) => reportContext(repository, context, input),
    },
    {
      id: 'inspect_agent_checkpoint',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: bothModes,
      required_context: ['agent_target'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: InspectAgentCheckpointCapabilityInputSchema,
      execute: (context, input) => inspectAgentCheckpoint(repository, context, input),
    },
  ];
}

function hasRequiredContext(context: AuthorizedAgentContextV1, required: RequiredContext) {
  switch (required) {
    case 'catalog':
      return context.allowed_scopes.length > 0;
    case 'run':
      return context.allowed_run_ids.length > 0;
    case 'signal':
      return context.allowed_signal_refs.length > 0;
    case 'decision':
      return context.active_decision !== null;
    case 'evidence':
      return context.allowed_evidence_refs.length > 0;
    case 'report':
      return context.allowed_report_refs.length > 0;
    case 'chart':
      return context.active_chart !== null;
    case 'priority_entity':
      return context.active_priority_entity !== null;
    case 'agent_target':
      return context.request.agent_target !== null;
  }
}

export class CapabilityRegistry {
  private readonly descriptors: ReadonlyMap<AgentCapabilityIdV1, CapabilityDescriptor>;

  constructor(
    private readonly repository: Repository,
    descriptors: readonly CapabilityDescriptor[] = defaultDescriptors(repository),
  ) {
    const byId = new Map<AgentCapabilityIdV1, CapabilityDescriptor>();
    for (const descriptor of descriptors) {
      if (byId.has(descriptor.id)) throw new Error(`DUPLICATE_CAPABILITY_ID:${descriptor.id}`);
      byId.set(descriptor.id, descriptor);
    }
    const requiredIds: AgentCapabilityIdV1[] = [
      'create_analysis',
      'get_analysis_result',
      'inspect_signal',
      'inspect_decision_intelligence',
      'inspect_visual',
      'inspect_priority_entity',
      'inspect_evidence',
      'get_report_context',
      'inspect_agent_checkpoint',
    ];
    if (byId.size !== requiredIds.length || requiredIds.some((id) => !byId.has(id)))
      throw new Error('CAPABILITY_REGISTRY_INVENTORY_INVALID');
    this.descriptors = byId;
  }

  available(context: AuthorizedAgentContextV1): AgentCapabilityIdV1[] {
    return [...this.descriptors.values()]
      .filter(
        (descriptor) =>
          descriptor.allowed_roles.includes(context.actor.role) &&
          descriptor.allowed_modes.includes(context.mode),
      )
      .map((descriptor) => descriptor.id);
  }

  descriptor(id: AgentCapabilityIdV1) {
    return this.descriptors.get(id) ?? null;
  }

  /** Validates a provider request before any executor has a chance to run. */
  preflight(context: AuthorizedAgentContextV1, invocationValue: CapabilityInvocation) {
    const invocation = CapabilityInvocationSchema.parse(invocationValue);
    const descriptor = this.descriptor(invocation.capability_id);
    if (!descriptor || !this.available(context).includes(invocation.capability_id))
      throw new CapabilityRegistryError('CAPABILITY_DENIED');
    for (const required of descriptor.required_context)
      if (!hasRequiredContext(context, required))
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    const input = descriptor.input_schema.parse(invocation.input) as Record<string, unknown>;
    const runId = typeof input.run_id === 'string' ? input.run_id : null;
    if (runId && !context.allowed_run_ids.includes(runId))
      throw new CapabilityRegistryError('CAPABILITY_DENIED');
    if (invocation.capability_id === 'inspect_signal') {
      if (
        !runId ||
        typeof input.signal_id !== 'string' ||
        !context.allowed_signal_refs.some(
          (reference) => reference.run_id === runId && reference.signal_id === input.signal_id,
        )
      )
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (invocation.capability_id === 'inspect_evidence') {
      if (
        !runId ||
        typeof input.artifact_id !== 'string' ||
        typeof input.evidence_path !== 'string' ||
        !context.allowed_evidence_refs.some(
          (reference) =>
            reference.run_id === runId &&
            reference.artifact_id === input.artifact_id &&
            reference.evidence_path === input.evidence_path,
        )
      )
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (invocation.capability_id === 'get_report_context') {
      if (
        !runId ||
        typeof input.report_id !== 'string' ||
        !context.allowed_report_refs.some(
          (reference) => reference.run_id === runId && reference.report_id === input.report_id,
        )
      )
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (invocation.capability_id === 'inspect_decision_intelligence') {
      if (!runId || context.active_report?.run_id !== runId)
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (invocation.capability_id === 'inspect_visual') {
      if (
        !runId ||
        typeof input.chart_id !== 'string' ||
        context.active_chart?.run_id !== runId ||
        context.active_chart.chart_id !== input.chart_id
      )
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (invocation.capability_id === 'inspect_priority_entity') {
      if (
        !runId ||
        typeof input.priority_entity_id !== 'string' ||
        context.active_priority_entity?.run_id !== runId ||
        context.active_priority_entity.priority_entity_id !== input.priority_entity_id
      )
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (invocation.capability_id === 'inspect_agent_checkpoint') {
      if (input.agent_target !== context.request.agent_target)
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    return { invocation, descriptor, input };
  }

  async execute(
    context: RuntimeCapabilityExecutionContext,
    invocationValue: CapabilityInvocation,
    budget: CapabilityExecutionBudget,
  ) {
    const { descriptor, input } = this.preflight(context.authorized_context, invocationValue);
    const used = budget.calls_by_capability.get(descriptor.id) ?? 0;
    if (
      budget.total_calls >= MAX_AGENT_CAPABILITY_CALLS ||
      used >= descriptor.max_calls_per_turn ||
      used >= AGENT_RUNTIME_LIMITS.max_invocations_per_capability ||
      (descriptor.kind === 'mutation' &&
        budget.mutation_calls >= MAX_AGENT_MUTATING_CAPABILITY_CALLS) ||
      (descriptor.creates_run && budget.new_analysis_runs >= MAX_AGENT_NEW_ANALYSIS_RUNS)
    )
      throw new CapabilityRegistryError('RUNTIME_LIMIT_EXCEEDED');
    // Membership and write policy can change after plan preflight. Recheck
    // immediately before every data-plane call, especially a mutation.
    let role: Role;
    try {
      role = await this.repository.authorize(
        context.authorized_context.actor.user_id,
        context.authorized_context.org_id,
        descriptor.kind === 'mutation',
      );
    } catch {
      // Treat a membership/write-policy change as authorization loss. It is
      // never safe to return earlier facts after this recheck fails.
      throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (!descriptor.allowed_roles.includes(role)) throw new CapabilityRegistryError('CAPABILITY_DENIED');
    budget.total_calls++;
    budget.calls_by_capability.set(descriptor.id, used + 1);
    if (descriptor.kind === 'mutation') budget.mutation_calls++;
    if (descriptor.creates_run) budget.new_analysis_runs++;
    let result: CapabilityResultV1;
    try {
      result = await descriptor.execute(context, input);
    } catch (error) {
      if (error instanceof CapabilityRegistryError) throw error;
      if (error instanceof RepositoryError && error.status === 403)
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
      if (descriptor.kind === 'read') return safeReadFailure(descriptor.id);
      throw new CapabilityRegistryError('CAPABILITY_UNAVAILABLE');
    }
    try {
      return CapabilityResultV1Schema.parse(result);
    } catch {
      throw new CapabilityRegistryError('CAPABILITY_OUTPUT_INVALID');
    }
  }
}

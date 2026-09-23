import {
  AgentTurnRequestSchema,
  type AgentKey,
  type AgentTurnRequest,
  type AnalysisRun,
  type Artifact,
  type ArtifactReference,
  type AvailableWorkspaceActionV1,
  type CanonicalEvidenceRef,
  type ContextResolutionIssueV1,
  type DecisionBrief,
  type DecisionIntelligencePack,
  type EvidenceRefV1,
  type Message,
  type ReportRefV1,
  type Role,
  type RunReference,
  type Scope,
  type SignalRef,
  type WorkspaceContextV1,
  type WorkspaceModeV1,
} from '@vda/contracts';
import { verifyArtifact } from '@vda/domain';
import type { Repository } from '@vda/db';
import {
  MAX_AGENT_AUTHORIZED_HISTORICAL_RUNS,
  MAX_AGENT_PROVIDER_CONTEXT_BYTES,
  MAX_AGENT_RECENT_MESSAGES,
} from './runtime-limits';

const MAX_MESSAGE_CHARS = 500;
const MAX_MESSAGE_CONTEXT_CHARS = 4_000;
const MAX_CONTEXT_EVIDENCE_REFS = 100;
// These are intentionally smaller than the server-side allowlists. The
// provider only needs a bounded navigation projection; registry preflight
// continues to use the complete reauthorized allowlist.
const MAX_PROVIDER_SIGNAL_REFS = 8;
const MAX_PROVIDER_EVIDENCE_REFS = 8;
const MAX_PROVIDER_DASHBOARD_IDS = 8;

export class RuntimeContextError extends Error {
  constructor(
    readonly code:
      | 'NO_AUTHORIZED_RESULT'
      | 'STALE_CONTEXT'
      | 'MISSING_CONTEXT'
      | 'RUNTIME_LIMIT_EXCEEDED',
    readonly retryable = false,
  ) {
    super(code);
  }
}

export type AuthorizedActorV1 = { user_id: string; role: Role };
export type AuthorizedConversationRefV1 = { conversation_id: string };
export type PublicRunContextV1 = {
  run_id: string;
  status: RunReference['status'];
  scope: Scope;
  data_as_of: string;
};
export type PublicReportContextV1 = ReportRefV1 & { artifact_ref: ArtifactReference };
export type PublicArtifactContextV1 = ArtifactReference;
export type PublicChartContextV1 = { run_id: string; chart_id: string };
export type PublicPriorityEntityContextV1 = { run_id: string; priority_entity_id: string };
export type AuthorizedDrilldownContextV1 = { run_id: string; drilldown_id: string };
export type PublicEvidenceContextV1 = EvidenceRefV1;

export type RuntimeDashboardAllowlist = {
  kpi_ids: string[];
  chart_ids: string[];
  priority_entity_ids: string[];
  insight_ids: string[];
  action_candidate_ids: string[];
  drilldown_ids: string[];
};

/** Compact, public-only decision identifiers for provider planning. */
export type RuntimeDecisionSummary = {
  decision_ref: { run_id: string; component_id: string };
  decision_artifact_ref: ArtifactReference;
  chart_pack_artifact_ref: ArtifactReference;
  status: DecisionIntelligencePack['decision_brief']['status'];
  semantic_version: string;
  visuals: Array<{ chart_id: string; role: 'primary' | 'supporting' }>;
  priorities: Array<{
    priority_entity_id: string;
    label: string;
    tier: 'critical' | 'high' | 'medium' | 'watch';
    support_level: 'high' | 'medium' | 'limited';
    drilldown_ids: string[];
  }>;
  drilldowns: Array<{ drilldown_id: string; label: string; kind: string }>;
};

/**
 * The only context passed to capability executors. It has no raw browser
 * snapshot: every selected identifier below has been resolved through an
 * organization-scoped repository method and exact run lineage.
 */
export type AuthorizedAgentContextV1 = {
  version: 'authorized-agent-context-v1';
  org_id: string;
  actor: AuthorizedActorV1;
  conversation: AuthorizedConversationRefV1;
  scope: Scope;
  data_as_of: string;
  mode: WorkspaceModeV1;
  active_run: PublicRunContextV1 | null;
  active_report: PublicReportContextV1 | null;
  active_artifact: PublicArtifactContextV1 | null;
  active_chart: PublicChartContextV1 | null;
  active_priority_entity: PublicPriorityEntityContextV1 | null;
  drilldown: AuthorizedDrilldownContextV1 | null;
  evidence: PublicEvidenceContextV1 | null;
  available_workspace_actions: AvailableWorkspaceActionV1[];
  resolution_issues: ContextResolutionIssueV1[];
  /** Server-derived request fields only; client references are intentionally absent. */
  request: {
    text: string;
    use_case: NonNullable<AgentTurnRequest['use_case']>;
    agent_target: AgentKey | null;
    signal_action: 'inspect' | 'analyze_segment' | null;
    requested_signal_ref: SignalRef | null;
  };
  allowed_scopes: Scope[];
  allowed_run_ids: string[];
  allowed_conversation_run_ids: string[];
  allowed_report_refs: ReportRefV1[];
  allowed_signal_refs: SignalRef[];
  allowed_evidence_refs: EvidenceRefV1[];
  allowed_dashboard: RuntimeDashboardAllowlist;
  active_decision: RuntimeDecisionSummary | null;
  policy: { requires_fresh_analysis: boolean };
  /** Bounded, public-only projection sent to planner/composer providers. */
  provider_context: Record<string, unknown>;
};

function sameScope(left: Scope, right: Scope) {
  return (
    left.project_external_id === right.project_external_id &&
    left.zone_external_id === right.zone_external_id
  );
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)];
}

function artifactReference(artifact: Artifact): ArtifactReference {
  return { run_id: artifact.run_id, artifact_id: artifact.artifact_id, kind: artifact.kind };
}

function compactMessages(messages: Message[]) {
  const compacted: Array<{ role: Message['role']; content: string }> = [];
  let remaining = MAX_MESSAGE_CONTEXT_CHARS;
  for (const message of messages.slice(-MAX_AGENT_RECENT_MESSAGES)) {
    if (!remaining) break;
    const content = message.content.trim().slice(0, Math.min(MAX_MESSAGE_CHARS, remaining));
    if (!content) continue;
    compacted.push({ role: message.role, content });
    remaining -= content.length;
  }
  return compacted;
}

function assistantRunIds(messages: Message[]) {
  return uniqueStrings(
    messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.parts)
      .flatMap((part) => {
        if ('run_id' in part && typeof part.run_id === 'string') return [part.run_id];
        if (
          (part.type === 'claim_ref' ||
            part.type === 'metric_ref' ||
            part.type === 'evidence_ref' ||
            part.type === 'quality_ref') &&
          typeof part.ref.run_id === 'string'
        )
          return [part.ref.run_id];
        if (part.type === 'workspace_action' && 'run_id' in part.action) return [part.action.run_id];
        return [];
      }),
  ).slice(0, MAX_AGENT_AUTHORIZED_HISTORICAL_RUNS);
}

function evidenceKey(artifactId: string, path: string) {
  return artifactId + '\u0000' + path;
}

function decisionEvidence(pack: DecisionIntelligencePack) {
  const references = new Map<string, CanonicalEvidenceRef>();
  const add = (values: readonly CanonicalEvidenceRef[]) => {
    for (const value of values) references.set(evidenceKey(value.artifact_id, value.path), value);
  };
  const brief = pack.decision_brief;
  add(pack.evidence_refs);
  add(brief.evidence_refs);
  add(brief.kpi_cards.map((item) => item.metric_ref));
  for (const item of brief.material_changes) {
    add(item.metric_refs);
    add(item.evidence_refs);
  }
  for (const item of brief.hotspots) {
    add([item.metric_ref]);
    add(item.evidence_refs);
  }
  for (const item of brief.business_implications) add(item.evidence_refs);
  for (const item of brief.watchouts) add(item.evidence_refs);
  add(brief.data_quality_summary.evidence_refs);
  for (const item of pack.priority_entities) {
    add(item.metric_refs);
    add(item.evidence_refs);
  }
  for (const item of pack.action_candidates) add(item.evidence_refs);
  for (const item of pack.drilldowns) if (item.kind === 'open_evidence') add(item.evidence_refs);
  return [...references.values()].slice(0, MAX_CONTEXT_EVIDENCE_REFS);
}

function dashboardAllowlist(pack: DecisionIntelligencePack | null): RuntimeDashboardAllowlist {
  if (!pack)
    return {
      kpi_ids: [],
      chart_ids: [],
      priority_entity_ids: [],
      insight_ids: [],
      action_candidate_ids: [],
      drilldown_ids: [],
    };
  return {
    kpi_ids: pack.decision_brief.kpi_cards.map((item) => item.kpi_id),
    chart_ids: pack.visual_story.ordered_visuals.map((item) => item.chart_id),
    priority_entity_ids: pack.priority_entities.map((item) => item.priority_entity_id),
    insight_ids: pack.decision_brief.business_implications.map((item) => item.implication_id),
    action_candidate_ids: pack.action_candidates.map((item) => item.action_candidate_id),
    drilldown_ids: pack.drilldowns.map((item) => item.drilldown_id),
  };
}

function providerDashboardAllowlist(allowlist: RuntimeDashboardAllowlist): RuntimeDashboardAllowlist {
  return {
    kpi_ids: allowlist.kpi_ids.slice(0, MAX_PROVIDER_DASHBOARD_IDS),
    chart_ids: allowlist.chart_ids.slice(0, MAX_PROVIDER_DASHBOARD_IDS),
    priority_entity_ids: allowlist.priority_entity_ids.slice(0, MAX_PROVIDER_DASHBOARD_IDS),
    insight_ids: allowlist.insight_ids.slice(0, MAX_PROVIDER_DASHBOARD_IDS),
    action_candidate_ids: allowlist.action_candidate_ids.slice(0, MAX_PROVIDER_DASHBOARD_IDS),
    drilldown_ids: allowlist.drilldown_ids.slice(0, MAX_PROVIDER_DASHBOARD_IDS),
  };
}

function compatibleRun(run: AnalysisRun, scope: Scope, dataAsOf: string) {
  return sameScope(run.request.scope, scope) && run.request.data_as_of === dataAsOf;
}

function briefSignalRefs(runId: string, brief: DecisionBrief): SignalRef[] {
  return [
    ...brief.current_state,
    ...brief.material_changes,
    ...brief.where_to_look,
    ...brief.data_quality,
  ].map((signal) => ({ run_id: runId, signal_id: signal.signal_id }));
}

function decisionSummary(
  pack: DecisionIntelligencePack,
  response: Extract<
    Awaited<ReturnType<Repository['decisionIntelligence']>>,
    { status: 'available' }
  >,
): RuntimeDecisionSummary {
  return {
    decision_ref: { run_id: response.run_id, component_id: pack.pack_id },
    decision_artifact_ref: {
      run_id: response.run_id,
      artifact_id: response.decision_intelligence_artifact_id,
      kind: 'decision_intelligence_pack',
    },
    chart_pack_artifact_ref: {
      run_id: response.run_id,
      artifact_id: pack.chart_pack_artifact_id,
      kind: 'chart_pack',
    },
    status: pack.decision_brief.status,
    semantic_version: pack.semantic_version,
    visuals: pack.visual_story.ordered_visuals.slice(0, 20).map((item) => ({
      chart_id: item.chart_id,
      role: item.role,
    })),
    priorities: pack.priority_entities.slice(0, 40).map((item) => ({
      priority_entity_id: item.priority_entity_id,
      label: item.entity.label,
      tier: item.tier,
      support_level: item.support_level,
      drilldown_ids: item.drilldown_ids.slice(0, 20),
    })),
    drilldowns: pack.drilldowns.slice(0, 100).map((item) => ({
      drilldown_id: item.drilldown_id,
      label: item.label,
      kind: item.kind,
    })),
  };
}

async function authorizedRun(
  repository: Repository,
  userId: string,
  orgId: string,
  runId: string,
  required: boolean,
) {
  try {
    return (await repository.getRun(userId, orgId, runId)).run;
  } catch {
    if (required) throw new RuntimeContextError('NO_AUTHORIZED_RESULT');
    return null;
  }
}

async function publicArtifact(
  repository: Repository,
  userId: string,
  orgId: string,
  runId: string,
  artifactId: string,
) {
  try {
    const artifact = await repository.publicArtifactById(userId, orgId, runId, artifactId);
    verifyArtifact(artifact);
    return artifact;
  } catch {
    return null;
  }
}

async function validatedChart(
  repository: Repository,
  userId: string,
  orgId: string,
  runId: string,
  pack: DecisionIntelligencePack,
  chartId: string,
) {
  if (!pack.visual_story.ordered_visuals.some((item) => item.chart_id === chartId)) return false;
  const chartPack = await publicArtifact(
    repository,
    userId,
    orgId,
    runId,
    pack.chart_pack_artifact_id,
  );
  if (
    !chartPack ||
    chartPack.kind !== 'chart_pack' ||
    !chartPack.payload.charts.some((item) => item.chart_id === chartId)
  )
    return false;
  for (const artifactId of chartPack.input_refs.slice(0, 12)) {
    const artifact = await publicArtifact(repository, userId, orgId, runId, artifactId);
    if (
      artifact?.kind === 'visual_evidence' &&
      artifact.payload.charts.some((item) => item.chart_id === chartId)
    )
      return true;
  }
  return false;
}

function boundedProviderContext(value: Record<string, unknown>) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_AGENT_PROVIDER_CONTEXT_BYTES)
    throw new RuntimeContextError('RUNTIME_LIMIT_EXCEEDED', true);
  return value;
}

function issue(
  issues: ContextResolutionIssueV1[],
  refKind: ContextResolutionIssueV1['ref_kind'],
  code: ContextResolutionIssueV1['code'],
  disposition: ContextResolutionIssueV1['disposition'] = 'drop',
) {
  issues.push({ ref_kind: refKind, code, disposition });
}

async function validatedPublicReport(
  repository: Repository,
  userId: string,
  orgId: string,
  ref: ReportRefV1,
): Promise<PublicReportContextV1 | null> {
  try {
    const record = await repository.getReport(userId, orgId, ref.report_id);
    if (record.report.run_id !== ref.run_id || record.report.artifact_id !== record.artifact.artifact_id)
      return null;
    const artifact = await publicArtifact(
      repository,
      userId,
      orgId,
      ref.run_id,
      record.report.artifact_id,
    );
    if (!artifact || artifact.kind !== 'report') return null;
    return { ...ref, artifact_ref: artifactReference(artifact) };
  } catch {
    return null;
  }
}

async function currentPublicReport(
  repository: Repository,
  userId: string,
  orgId: string,
  runId: string,
) {
  const reports = await repository.listReports(userId, orgId).catch(() => []);
  const candidates: PublicReportContextV1[] = [];
  for (const report of reports) {
    if (report.run_id !== runId) continue;
    const valid = await validatedPublicReport(repository, userId, orgId, {
      run_id: runId,
      report_id: report.report_id,
    });
    if (valid) candidates.push(valid);
  }
  // Omission may be filled only when there is one public, validated result.
  // Choosing an arbitrary revision would silently substitute user context.
  return candidates.length === 1 ? candidates[0]! : null;
}

/**
 * Return the snapshot's highest-priority root candidate.  The client schema
 * checks descendants when an active run is present, but it is intentionally
 * not an authorization boundary: a malformed collection of child references
 * must degrade each child rather than allow facts from multiple runs to merge.
 */
function workspaceRootRunId(workspace: WorkspaceContextV1 | null, input: AgentTurnRequest) {
  return (
    workspace?.active_run_ref?.run_id ??
    workspace?.active_report_ref?.run_id ??
    workspace?.active_artifact_ref?.run_id ??
    workspace?.dashboard_selection?.chart_ref?.run_id ??
    workspace?.dashboard_selection?.priority_entity_ref?.run_id ??
    workspace?.drilldown?.run_id ??
    workspace?.evidence_ref?.run_id ??
    input.drilldown_ref?.run_id ??
    null
  );
}

function isRootDescendant(rootRunId: string | null, runId: string | undefined) {
  return Boolean(rootRunId && runId && rootRunId === runId);
}

/**
 * A route is the source of truth for an existing conversation. This helper is
 * deliberately exported so callers can reject a conflicting browser snapshot
 * before provider work while retaining idempotent replay behavior.
 */
export function assertWorkspaceConversationCoherence(
  input: AgentTurnRequest,
  routeConversationId?: string,
) {
  const workspace = input.workspace_context;
  if (!workspace) return;
  if (workspace.conversation_id !== (routeConversationId ?? null))
    throw new RuntimeContextError('NO_AUTHORIZED_RESULT');
}

/**
 * Rehydrates an untrusted navigation snapshot from root to child. A failed
 * child becomes a metadata-only resolution issue; it never erases an already
 * authorized parent or discloses whether an inaccessible object exists.
 */
export class RuntimeContextBuilder {
  constructor(private readonly repository: Repository) {}

  async build(
    userId: string,
    inputValue: AgentTurnRequest,
    conversationId: string,
  ): Promise<AuthorizedAgentContextV1> {
    const input = AgentTurnRequestSchema.parse(inputValue);
    const workspace = input.workspace_context ?? null;
    if (workspace && workspace.conversation_id !== null && workspace.conversation_id !== conversationId)
      throw new RuntimeContextError('NO_AUTHORIZED_RESULT');

    let role: Role;
    try {
      role = await this.repository.authorize(userId, input.org_id);
    } catch {
      // Membership failures and missing tenant context intentionally collapse
      // to the same public result.
      throw new RuntimeContextError('NO_AUTHORIZED_RESULT');
    }
    let catalog: Awaited<ReturnType<Repository['catalog']>>;
    let page: Awaited<ReturnType<Repository['listMessages']>>;
    try {
      [catalog, page] = await Promise.all([
        this.repository.catalog(userId, input.org_id),
        this.repository.listMessages(userId, input.org_id, conversationId, {
          limit: MAX_AGENT_RECENT_MESSAGES,
          cursor: null,
        }),
        // The returned object is not provider context. This scoped lookup
        // establishes that the route conversation belongs to this tenant.
        this.repository.getConversation(userId, input.org_id, conversationId),
      ]).then(([authorizedCatalog, messages]) => [authorizedCatalog, messages] as const);
    } catch {
      throw new RuntimeContextError('NO_AUTHORIZED_RESULT');
    }

    const project = catalog.projects.find(
      (item) => item.project_external_id === input.scope.project_external_id,
    );
    if (
      !project ||
      (input.scope.zone_external_id !== null &&
        !project.zones.some((zone) => zone.zone_external_id === input.scope.zone_external_id))
    )
      throw new RuntimeContextError('MISSING_CONTEXT');

    let scope = input.scope;
    let requestedSignalRef: SignalRef | null = null;
    if (input.signal_ref) {
      const signalRun = await authorizedRun(
        this.repository,
        userId,
        input.org_id,
        input.signal_ref.run_id,
        false,
      );
      if (signalRun) {
        try {
          const brief = await this.repository.decisionBrief(userId, input.org_id, signalRun.run_id);
          const signal = [
            ...brief.decision_brief.current_state,
            ...brief.decision_brief.material_changes,
            ...brief.decision_brief.where_to_look,
            ...brief.decision_brief.data_quality,
          ].find((item) => item.signal_id === input.signal_ref?.signal_id);
          if (signal) {
            requestedSignalRef = input.signal_ref;
            if (input.signal_action === 'analyze_segment') {
              const signalProject = catalog.projects.find(
                (item) => item.project_external_id === brief.scope.project_external_id,
              );
              if (
                signal.dimension !== 'zone' ||
                !signal.segment_key ||
                !signalProject?.zones.some((zone) => zone.zone_external_id === signal.segment_key)
              )
                throw new RuntimeContextError('MISSING_CONTEXT');
              scope = {
                project_external_id: brief.scope.project_external_id,
                zone_external_id: signal.segment_key,
              };
            }
          }
        } catch (error) {
          if (error instanceof RuntimeContextError) throw error;
        }
      }
      if (input.signal_action && !requestedSignalRef)
        throw new RuntimeContextError('NO_AUTHORIZED_RESULT');
    }

    const issues: ContextResolutionIssueV1[] = [];
    const rootRunId = workspaceRootRunId(workspace, input);
    const rootRun = rootRunId
      ? await authorizedRun(this.repository, userId, input.org_id, rootRunId, true)
      : null;
    const requiresFreshAnalysis = Boolean(rootRun && !compatibleRun(rootRun, scope, input.data_as_of));
    const activeRun = rootRun && !requiresFreshAnalysis ? rootRun : null;
    if (rootRun && requiresFreshAnalysis) issue(issues, 'run', 'STALE_CONTEXT');

    let report: PublicReportContextV1 | null = null;
    let reportInvalid = false;
    if (activeRun && workspace?.active_report_ref && isRootDescendant(rootRunId, workspace.active_report_ref.run_id)) {
      report = await validatedPublicReport(
        this.repository,
        userId,
        input.org_id,
        workspace.active_report_ref,
      );
      if (!report) {
        reportInvalid = true;
        issue(issues, 'report', 'NO_AUTHORIZED_RESULT');
      }
    } else if (workspace?.active_report_ref && activeRun) {
      reportInvalid = true;
      issue(issues, 'report', 'NO_AUTHORIZED_RESULT');
    } else if (activeRun && !workspace?.active_report_ref) {
      report = await currentPublicReport(this.repository, userId, input.org_id, activeRun.run_id);
      if (report) issue(issues, 'report', 'MISSING_CONTEXT', 'replace');
    } else if (workspace?.active_report_ref && !activeRun) {
      issue(issues, 'report', 'STALE_CONTEXT');
    }

    let activeArtifact: PublicArtifactContextV1 | null = null;
    if (
      activeRun &&
      !reportInvalid &&
      workspace?.active_artifact_ref &&
      isRootDescendant(rootRunId, workspace.active_artifact_ref.run_id)
    ) {
      const artifact = await publicArtifact(
        this.repository,
        userId,
        input.org_id,
        activeRun.run_id,
        workspace.active_artifact_ref.artifact_id,
      );
      if (artifact) activeArtifact = artifactReference(artifact);
      else issue(issues, 'artifact', 'NO_AUTHORIZED_RESULT');
    } else if (workspace?.active_artifact_ref && activeRun) {
      issue(issues, 'artifact', 'NO_AUTHORIZED_RESULT');
    } else if (workspace?.active_artifact_ref && !activeRun) {
      issue(issues, 'artifact', 'STALE_CONTEXT');
    }

    const decision = activeRun
      ? await this.repository
          .decisionIntelligence(userId, input.org_id, activeRun.run_id)
          .catch(() => null)
      : null;
    const pack = decision?.status === 'available' ? decision.decision_intelligence : null;
    const allowedDashboard = dashboardAllowlist(pack);
    const activeDecision = pack && decision?.status === 'available' ? decisionSummary(pack, decision) : null;

    let activeChart: PublicChartContextV1 | null = null;
    const chartRef = workspace?.dashboard_selection?.chart_ref ?? null;
    if (chartRef) {
      if (
        activeRun &&
        !reportInvalid &&
        pack &&
        isRootDescendant(rootRunId, chartRef.run_id) &&
        allowedDashboard.chart_ids.includes(chartRef.chart_id) &&
        (await validatedChart(this.repository, userId, input.org_id, activeRun.run_id, pack, chartRef.chart_id))
      )
        activeChart = { run_id: activeRun.run_id, chart_id: chartRef.chart_id };
      else issue(issues, 'chart', activeRun ? 'NO_AUTHORIZED_RESULT' : 'STALE_CONTEXT');
    }

    let activePriority: PublicPriorityEntityContextV1 | null = null;
    const priorityRef = workspace?.dashboard_selection?.priority_entity_ref ?? null;
    if (priorityRef) {
      if (
        activeRun &&
        !reportInvalid &&
        pack &&
        isRootDescendant(rootRunId, priorityRef.run_id) &&
        allowedDashboard.priority_entity_ids.includes(priorityRef.priority_entity_id)
      )
        activePriority = { run_id: activeRun.run_id, priority_entity_id: priorityRef.priority_entity_id };
      else issue(issues, 'priority_entity', activeRun ? 'NO_AUTHORIZED_RESULT' : 'STALE_CONTEXT');
    }

    let drilldown: AuthorizedDrilldownContextV1 | null = null;
    const drilldownRef = workspace?.drilldown ?? input.drilldown_ref ?? null;
    if (drilldownRef) {
      if (
        activeRun &&
        !reportInvalid &&
        pack &&
        isRootDescendant(rootRunId, drilldownRef.run_id) &&
        allowedDashboard.drilldown_ids.includes(drilldownRef.drilldown_id)
      )
        drilldown = { run_id: activeRun.run_id, drilldown_id: drilldownRef.drilldown_id };
      else issue(issues, 'drilldown', activeRun ? 'NO_AUTHORIZED_RESULT' : 'STALE_CONTEXT');
    }

    let evidence: PublicEvidenceContextV1 | null = null;
    if (workspace?.evidence_ref) {
      const candidate = workspace.evidence_ref;
      const matchingPath =
        pack &&
        decisionEvidence(pack).some(
          (item) => item.artifact_id === candidate.artifact_id && item.path === candidate.evidence_path,
        );
      const artifact =
        activeRun &&
        matchingPath &&
        !reportInvalid &&
        isRootDescendant(rootRunId, candidate.run_id)
          ? await publicArtifact(this.repository, userId, input.org_id, activeRun.run_id, candidate.artifact_id)
          : null;
      if (artifact)
        evidence = {
          run_id: activeRun!.run_id,
          artifact_id: candidate.artifact_id,
          evidence_path: candidate.evidence_path,
        };
      else issue(issues, 'evidence', activeRun ? 'NO_AUTHORIZED_RESULT' : 'STALE_CONTEXT');
    }

    const historicalRunIds = assistantRunIds(page.messages);
    const candidateRunIds = uniqueStrings([
      ...(activeRun ? [activeRun.run_id] : []),
      ...(requestedSignalRef ? [requestedSignalRef.run_id] : []),
      ...historicalRunIds,
    ]).slice(0, MAX_AGENT_AUTHORIZED_HISTORICAL_RUNS);
    const compatibleRuns = (
      await Promise.all(
        candidateRunIds.map((runId) => authorizedRun(this.repository, userId, input.org_id, runId, false)),
      )
    ).filter((run): run is AnalysisRun => Boolean(run && compatibleRun(run, scope, input.data_as_of)));
    const allowedRunIds = compatibleRuns.map((run) => run.run_id);

    const allowedSignalRefs: SignalRef[] = [];
    const allowedEvidenceRefs: EvidenceRefV1[] = [];
    for (const run of compatibleRuns) {
      try {
        const brief = await this.repository.decisionBrief(userId, input.org_id, run.run_id);
        allowedSignalRefs.push(...briefSignalRefs(run.run_id, brief.decision_brief));
      } catch {
        // Optional public brief data never expands authorization.
      }
      try {
        const available = await this.repository.decisionIntelligence(userId, input.org_id, run.run_id);
        if (available.status !== 'available') continue;
        const candidates = decisionEvidence(available.decision_intelligence)
          .slice(0, Math.max(0, MAX_CONTEXT_EVIDENCE_REFS - allowedEvidenceRefs.length))
          .map((item) => ({ run_id: run.run_id, artifact_id: item.artifact_id, evidence_path: item.path }));
        const visible = new Set(
          (
            await this.repository.publicArtifactsByIds(
              userId,
              input.org_id,
              run.run_id,
              candidates.map((item) => item.artifact_id),
            )
          ).map((artifact) => artifact.artifact_id),
        );
        allowedEvidenceRefs.push(...candidates.filter((item) => visible.has(item.artifact_id)));
      } catch {
        // Missing/invalid public artifacts remain unavailable.
      }
    }

    const dedupedSignalRefs = uniqueStrings(
      [...allowedSignalRefs, ...(requestedSignalRef ? [requestedSignalRef] : [])].map(
        (item) => item.run_id + '\u0000' + item.signal_id,
      ),
    ).map((value) => {
      const [run_id, signal_id] = value.split('\u0000');
      return { run_id: run_id!, signal_id: signal_id! };
    });
    const dedupedEvidenceRefs = uniqueStrings(
      allowedEvidenceRefs.map(
        (item) => item.run_id + '\u0000' + item.artifact_id + '\u0000' + item.evidence_path,
      ),
    )
      .slice(0, MAX_CONTEXT_EVIDENCE_REFS)
      .map((value) => {
        const [run_id, artifact_id, evidence_path] = value.split('\u0000');
        return { run_id: run_id!, artifact_id: artifact_id!, evidence_path: evidence_path! };
      });
    const allowedReports = report ? [{ run_id: report.run_id, report_id: report.report_id }] : [];

    const providerContext = boundedProviderContext({
      version: 'authorized-agent-context-v1',
      question: input.text,
      scope,
      data_as_of: input.data_as_of,
      mode: workspace?.mode ?? 'agent_chat',
      recent_messages: compactMessages(page.messages),
      allowed: {
        run_ids: allowedRunIds,
        report_refs: allowedReports,
        signal_refs: dedupedSignalRefs.slice(0, MAX_PROVIDER_SIGNAL_REFS),
        evidence_refs: dedupedEvidenceRefs.slice(0, MAX_PROVIDER_EVIDENCE_REFS),
        dashboard: providerDashboardAllowlist(allowedDashboard),
      },
      active: {
        run: activeRun ? { run_id: activeRun.run_id, status: activeRun.status } : null,
        report: report ? { run_id: report.run_id, report_id: report.report_id } : null,
        artifact: activeArtifact,
        chart: activeChart,
        priority_entity: activePriority,
        drilldown,
        evidence,
      },
      resolution_issues: issues,
    });

    return {
      version: 'authorized-agent-context-v1',
      org_id: input.org_id,
      actor: { user_id: userId, role },
      conversation: { conversation_id: conversationId },
      scope,
      data_as_of: input.data_as_of,
      mode: workspace?.mode ?? 'agent_chat',
      active_run: activeRun
        ? {
            run_id: activeRun.run_id,
            status: activeRun.status,
            scope: activeRun.request.scope,
            data_as_of: activeRun.request.data_as_of,
          }
        : null,
      active_report: report,
      active_artifact: activeArtifact,
      active_chart: activeChart,
      active_priority_entity: activePriority,
      drilldown,
      evidence,
      available_workspace_actions: [],
      resolution_issues: issues,
      request: {
        text: input.text,
        use_case: input.use_case ?? 'slow_moving_inventory',
        agent_target: input.agent_target ?? null,
        signal_action: input.signal_action ?? null,
        requested_signal_ref: requestedSignalRef,
      },
      allowed_scopes: catalog.projects.slice(0, 50).flatMap((item) => [
        { project_external_id: item.project_external_id, zone_external_id: null },
        ...item.zones.slice(0, 50).map((zone) => ({
          project_external_id: item.project_external_id,
          zone_external_id: zone.zone_external_id,
        })),
      ]),
      allowed_run_ids: allowedRunIds,
      allowed_conversation_run_ids: historicalRunIds.filter((runId) => allowedRunIds.includes(runId)),
      allowed_report_refs: allowedReports,
      allowed_signal_refs: dedupedSignalRefs,
      allowed_evidence_refs: dedupedEvidenceRefs,
      allowed_dashboard: allowedDashboard,
      active_decision: activeDecision,
      policy: { requires_fresh_analysis: requiresFreshAnalysis },
      provider_context: providerContext,
    };
  }
}

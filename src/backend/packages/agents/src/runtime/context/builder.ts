import {
  AgentTurnRequestSchema,
  resolveReportIntent,
  type AgentTurnRequest,
  type AnalysisRun,
  type Artifact,
  type ArtifactReference,
  type ContextResolutionIssueV1,
  type DecisionIntelligencePack,
  type EvidenceRefV1,
  type ReportRefV1,
  type Role,
  type Scope,
  type SignalRef,
  type WorkspaceContextV1,
} from '@vda/contracts';
import { verifyArtifact } from '@vda/domain';
import { MAX_AGENT_AUTHORIZED_HISTORICAL_RUNS, MAX_AGENT_RECENT_MESSAGES } from '../limits';
import {
  MAX_CONTEXT_EVIDENCE_REFS,
  assistantRunIds,
  briefSignalRefs,
  dashboardAllowlist,
  decisionEvidence,
  uniqueStrings,
} from './allowlists';
import {
  MAX_PROVIDER_EVIDENCE_REFS,
  MAX_PROVIDER_SIGNAL_REFS,
  boundedProviderContext,
  compactMessages,
  decisionSummary,
  providerDashboardAllowlist,
} from './provider-projection';
import {
  RuntimeContextError,
  type AuthorizedAgentContextV1,
  type AuthorizedDrilldownContextV1,
  type PublicArtifactContextV1,
  type PublicChartContextV1,
  type PublicEvidenceContextV1,
  type PublicPriorityEntityContextV1,
  type PublicReportContextV1,
} from './types';
import type { Repository } from '@vda/db';
import { ContextResolver } from './resolver';
import { MemoryRetriever } from './memory';
import { budgetContext, estimateContextTokens } from './budget';

function sameScope(left: Scope, right: Scope) {
  return (
    left.project_external_id === right.project_external_id &&
    left.zone_external_id === right.zone_external_id
  );
}

function artifactReference(artifact: Artifact): ArtifactReference {
  return { run_id: artifact.run_id, artifact_id: artifact.artifact_id, kind: artifact.kind };
}

function compatibleRun(run: AnalysisRun, scope: Scope, dataAsOf: string) {
  return sameScope(run.request.scope, scope) && run.request.data_as_of === dataAsOf;
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
    if (
      record.report.run_id !== ref.run_id ||
      record.report.artifact_id !== record.artifact.artifact_id
    )
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
    let workspace = input.workspace_context ?? null;
    if (
      workspace &&
      workspace.conversation_id !== null &&
      workspace.conversation_id !== conversationId
    )
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

    const resolved = await new ContextResolver(this.repository).resolve(userId, input, conversationId);
    if (resolved.ambiguous_update) throw new RuntimeContextError('MISSING_CONTEXT');
    if (resolved.source === 'message' || resolved.source === 'reply' ||
      (resolved.source === 'thread' && (resolved.active || !workspace))) {
      const active = resolved.active;
      const runId = active?.run_id ?? (resolved.source === 'thread' ? resolved.thread.current_run_id : null);
      workspace = {
        version: 1, mode: workspace?.mode ?? 'agent_chat', org_id: input.org_id,
        conversation_id: conversationId, scope: input.scope, data_as_of: input.data_as_of,
        active_run_ref: runId ? { run_id: runId } : null,
        active_report_ref: active?.type === 'report' && active.run_id
          ? { report_id: active.id, run_id: active.run_id } : null,
        active_artifact_ref: active?.artifact_id && active.run_id
          ? { artifact_id: active.artifact_id, run_id: active.run_id } : null,
        dashboard_selection: null, drilldown: null, evidence_ref: null,
      };
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
    const explicitReferences = resolved.source === 'message' || resolved.source === 'reply';
    const rootRunId = workspaceRootRunId(workspace, input);
    const rootRun = rootRunId
      ? await authorizedRun(this.repository, userId, input.org_id, rootRunId, true)
      : null;
    const requiresFreshAnalysis = Boolean(
      rootRun && !explicitReferences && !compatibleRun(rootRun, scope, input.data_as_of),
    );
    const activeRun = rootRun && !requiresFreshAnalysis ? rootRun : null;
    if (rootRun && requiresFreshAnalysis) issue(issues, 'run', 'STALE_CONTEXT');

    let report: PublicReportContextV1 | null = null;
    let reportInvalid = false;
    if (
      activeRun &&
      workspace?.active_report_ref &&
      isRootDescendant(rootRunId, workspace.active_report_ref.run_id)
    ) {
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
    } else if (activeRun && !workspace?.active_report_ref && !input.workspace_context && resolved.source === 'none') {
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
    const activeDecision =
      pack && decision?.status === 'available' ? decisionSummary(pack, decision) : null;

    let activeChart: PublicChartContextV1 | null = null;
    const chartRef = workspace?.dashboard_selection?.chart_ref ?? null;
    if (chartRef) {
      if (
        activeRun &&
        !reportInvalid &&
        pack &&
        isRootDescendant(rootRunId, chartRef.run_id) &&
        allowedDashboard.chart_ids.includes(chartRef.chart_id) &&
        (await validatedChart(
          this.repository,
          userId,
          input.org_id,
          activeRun.run_id,
          pack,
          chartRef.chart_id,
        ))
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
        activePriority = {
          run_id: activeRun.run_id,
          priority_entity_id: priorityRef.priority_entity_id,
        };
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
          (item) =>
            item.artifact_id === candidate.artifact_id && item.path === candidate.evidence_path,
        );
      const artifact =
        activeRun && matchingPath && !reportInvalid && isRootDescendant(rootRunId, candidate.run_id)
          ? await publicArtifact(
              this.repository,
              userId,
              input.org_id,
              activeRun.run_id,
              candidate.artifact_id,
            )
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
    // Explicit attachments/replies may intentionally compare periods. A stale
    // default or browser selection must still satisfy the requested data scope.
    const candidateRunIds = uniqueStrings([
      ...resolved.references.flatMap((ref) => ref.run_id ? [ref.run_id] : []),
      ...(activeRun ? [activeRun.run_id] : []),
      ...(requestedSignalRef ? [requestedSignalRef.run_id] : []),
      ...historicalRunIds,
    ]).slice(0, MAX_AGENT_AUTHORIZED_HISTORICAL_RUNS);
    const compatibleRuns = (
      await Promise.all(
        candidateRunIds.map((runId) =>
          authorizedRun(this.repository, userId, input.org_id, runId, false),
        ),
      )
    ).filter((run): run is AnalysisRun =>
      Boolean(run && (compatibleRun(run, scope, input.data_as_of) ||
        (explicitReferences && resolved.references.some((ref) => ref.run_id === run.run_id)))),
    );
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
        const available = await this.repository.decisionIntelligence(
          userId,
          input.org_id,
          run.run_id,
        );
        if (available.status !== 'available') continue;
        const candidates = decisionEvidence(available.decision_intelligence)
          .slice(0, Math.max(0, MAX_CONTEXT_EVIDENCE_REFS - allowedEvidenceRefs.length))
          .map((item) => ({
            run_id: run.run_id,
            artifact_id: item.artifact_id,
            evidence_path: item.path,
          }));
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
    const allowedReports = [
      ...(report ? [{ run_id: report.run_id, report_id: report.report_id }] : []),
      ...resolved.references.flatMap((ref) => ref.type === 'report' && ref.run_id && allowedRunIds.includes(ref.run_id)
        ? [{ run_id: ref.run_id, report_id: ref.id }] : []),
    ].filter((ref, index, all) => all.findIndex((other) => other.report_id === ref.report_id) === index);

    const memory = await new MemoryRetriever(this.repository).retrieve({
      userId, orgId: input.org_id, conversationId,
      runId: activeRun?.request.conversation_id === conversationId ? activeRun.run_id : undefined,
      task: input.text,
      maxTokens: 1_200,
    });

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
      context_source: resolved.source,
      referenced_context: resolved.references.filter((ref) => !ref.run_id || allowedRunIds.includes(ref.run_id)),
    });
    const memoryBudget = budgetContext([
      { key: 'working', value: memory.working, priority: 3 },
      { key: 'episodic', value: memory.episodic, priority: 2 },
      { key: 'workspace', value: memory.workspace, priority: 1 },
    ], Math.max(0, 6_000 - estimateContextTokens(providerContext)));
    const boundedContext = boundedProviderContext({ ...providerContext, memory: memoryBudget.context,
      context_metadata: { source: resolved.source, estimated_tokens: estimateContextTokens(providerContext) + memoryBudget.estimated_tokens,
        memory_counts: { working: memory.working.length, episodic: memory.episodic.length, workspace: memory.workspace.length } },
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
        report_intent: resolveReportIntent(input),
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
      allowed_conversation_run_ids: historicalRunIds.filter((runId) =>
        allowedRunIds.includes(runId),
      ),
      allowed_report_refs: allowedReports,
      allowed_signal_refs: dedupedSignalRefs,
      allowed_evidence_refs: dedupedEvidenceRefs,
      allowed_dashboard: allowedDashboard,
      active_decision: activeDecision,
      policy: { requires_fresh_analysis: requiresFreshAnalysis },
      provider_context: boundedContext,
    };
  }
}

import type {
  AgentKey,
  AgentTurnRequest,
  ArtifactReference,
  AvailableWorkspaceActionV1,
  ContextResolutionIssueV1,
  DecisionIntelligencePack,
  EvidenceRefV1,
  ReportRefV1,
  Role,
  RunReference,
  Scope,
  SignalRef,
  WorkspaceModeV1,
} from '@vda/contracts';

export class RuntimeContextError extends Error {
  constructor(
    readonly code:
      'NO_AUTHORIZED_RESULT' | 'STALE_CONTEXT' | 'MISSING_CONTEXT' | 'RUNTIME_LIMIT_EXCEEDED',
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

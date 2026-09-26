export {
  canonical,
  contentHash,
  artifactHash,
  stableId,
  verifyArtifact,
  bindClaims,
  SAFE_SUMMARY,
  validateDecisionBrief,
  validateReport,
  reportSections,
} from '@vda/domain';
export {
  createProvider,
  GeminiProvider,
  OpenAIProvider,
  FallbackNarrativeProvider,
} from './legacy-workflow/narrative/provider';
export type { Narrative, NarrativeProvider, NarrativeContext } from './legacy-workflow/narrative/provider';
export {
  createDecisionProvider,
  GeminiAgentDecisionProvider,
  OpenAIAgentDecisionProvider,
  FallbackAgentDecisionProvider,
} from './chat/legacy/provider';
export type { AgentDecisionContext, AgentDecisionProvider } from './chat/legacy/provider';
export {
  runtimeLimits,
  AGENT_RUNTIME_LIMITS,
  MAX_AGENT_PLAN_STEPS,
  MAX_AGENT_CAPABILITY_CALLS,
  MAX_AGENT_NEW_ANALYSIS_RUNS,
  MAX_AGENT_MUTATING_CAPABILITY_CALLS,
  MAX_AGENT_PLANNER_CALLS,
  MAX_AGENT_COMPOSER_CALLS,
  MAX_AGENT_PROVIDER_ATTEMPTS,
  MAX_AGENT_RECENT_MESSAGES,
  MAX_AGENT_AUTHORIZED_HISTORICAL_RUNS,
  MAX_AGENT_PROVIDER_CONTEXT_BYTES,
  MAX_AGENT_COMPOSER_OBSERVATIONS,
  MAX_AGENT_WORKSPACE_ACTIONS,
  MAX_AGENT_GROUNDING_REFS_PER_OBSERVATION,
  MAX_AGENT_PLANNED_OBSERVATION_BYTES,
  MAX_AGENT_TURN_TIMEOUT_MS,
} from './runtime/limits';
export type { AgentRuntimeLimits } from './runtime/limits';
export type {
  AgentRuntimeProviderName,
  RuntimeProviderMetadata,
  AgentRuntimeProviderResult,
  AgentRuntimePlannerInput,
  AgentRuntimeComposerObservation,
  AgentRuntimeComposerWorkspaceAction,
  AgentRuntimeComposerInput,
  AgentRuntimeComposerValidator,
  AgentRuntimePlannerValidator,
  AgentRuntimeProvider,
} from './runtime/providers/contracts';
export type {
  RuntimeProviderTelemetryEvent,
  RuntimeProviderTelemetry,
} from './runtime/providers/telemetry';
export { emitRuntimeProviderTelemetry } from './runtime/providers/telemetry';
export { AgentRuntimeProviderError, isTimeoutAbort } from './runtime/providers/errors';
export { plannerInstructions, composerInstructions } from './runtime/providers/instructions';
export { GeminiAgentRuntimeProvider } from './runtime/providers/gemini-provider';
export { OpenAIAgentRuntimeProvider } from './runtime/providers/openai-provider';
export { OrderedFallbackAgentRuntimeProvider } from './runtime/providers/fallback';
export { createAgentRuntimeProvider } from './runtime/providers/factory';
export { RuntimeContextError } from './runtime/context/types';
export type {
  AuthorizedActorV1,
  AuthorizedConversationRefV1,
  PublicRunContextV1,
  PublicReportContextV1,
  PublicArtifactContextV1,
  PublicChartContextV1,
  PublicPriorityEntityContextV1,
  AuthorizedDrilldownContextV1,
  PublicEvidenceContextV1,
  RuntimeDashboardAllowlist,
  RuntimeDecisionSummary,
  AuthorizedAgentContextV1,
} from './runtime/context/types';
export {
  assertWorkspaceConversationCoherence,
  RuntimeContextBuilder,
} from './runtime/context/builder';
export {
  createCapabilityExecutionBudget,
  CapabilityRegistry,
} from './runtime/capabilities/registry';
export { CapabilityRegistryError } from './runtime/capabilities/contracts';
export type {
  CapabilityDescriptor,
  CapabilityExecutionBudget,
  RuntimeCapabilityExecutionContext,
} from './runtime/capabilities/contracts';
export {
  validateAgentPlan,
  plannerErrorCode,
  PlannerValidationError,
} from './runtime/planning/planner';
export type { ValidatedAgentPlan } from './runtime/planning/planner';
export {
  validateAndRenderGroundedResponse,
  deterministicGroundedAnswer,
  GroundingValidationError,
} from './runtime/composition/answer-composer';
export type { RenderedGroundedResponse } from './runtime/composition/answer-composer';
export type { AgentActivitySink } from './runtime/activity';
export { AgentActivityEmitter } from './runtime/activity';
export { AgentRuntime } from './runtime/runtime';
export { isApprovedDurableAnalysisTurn } from '@vda/contracts';
export { TeamRuntime, AgentMessageBus } from './runtime/team/runtime';
export type { TeamRuntimeOptions, RegisteredAgent, InvocationContext } from './runtime/team/runtime';
export { ToolRegistry, ToolRuntimeError, ToolResultSchema } from './runtime/team/tools';
export type { ToolDefinition, ToolResult, ToolExecutionContext, ToolExecutionEvent } from './runtime/team/tools';
export { McpGateway } from './runtime/team/mcp-gateway';
export type { McpSession, McpServerDefinition, McpToolCapability } from './runtime/team/mcp-gateway';
export { ANALYSIS_AGENT_DEFINITIONS } from './runtime/team/definitions';
export { XaiAgentRuntimeProvider } from './runtime/providers/xai-provider';
export {
  validateVisualEvidence,
  chartPayloadFingerprint,
  ChartBuilder,
} from './analysis/chart-builder';
export type { BuiltContext } from './chat/legacy/context-builder';
export { ConversationContextBuilder } from './chat/legacy/context-builder';
export { AgentChatOrchestrator } from './chat/legacy/orchestrator';
export {
  buildComparisonPack,
  validateComparisonPack,
  ComparisonAgentError,
} from './analysis-v1/agents/comparison-agent';
export type { ComparisonAgentInput } from './analysis-v1/agents/comparison-agent';
export { coordinateRun, CoordinatorError } from './analysis-v1/agents/coordinator-agent';
export type { CoordinatorInput } from './analysis-v1/agents/coordinator-agent';
export {
  calculateDataAgentOutput,
  buildDataAnalysisPack,
  validateDataAnalysisPack,
  DataAgentError,
} from './analysis-v1/agents/data-agent';
export type {
  DataArtifactKeys,
  DataAgentArtifacts,
  DataAnalysisPackInput,
  DeterministicDataOutput,
} from './analysis-v1/agents/data-agent';
export {
  buildChartEvidence,
  buildChartPack,
  validateChartPack,
  ChartAgentError,
} from './analysis-v1/agents/chart-agent';
export type { ChartAgentInput, ChartPackInput } from './analysis-v1/agents/chart-agent';
export {
  buildAnalysisPack,
  validateAnalysisPack,
  AnalystAgentError,
} from './analysis-v1/agents/analyst-agent';
export type { AnalystAgentInput } from './analysis-v1/agents/analyst-agent';
export {
  loadBranchStageArtifacts,
  executeComparisonBranch,
  executeChartBranch,
  executeAnalystBranch,
  executeIndependentBranches,
  executeAgentThroughBranches,
} from './analysis-v1/stages/branches';
export type {
  ComparisonBranchResult,
  ChartBranchResult,
  AnalystBranchResult,
  AgentBranchStageResult,
  PersistedAgentBranchStageResult,
  AgentWorkflowThroughBranchesResult,
} from './analysis-v1/stages/branches';
export {
  buildLegacyInsightPayload,
  buildInsightPack,
  validateInsightPack,
  InsightAgentError,
} from './analysis-v1/agents/insight-agent';
export type {
  InsightNarrative,
  InsightSourceInput,
  InsightAgentInput,
} from './analysis-v1/agents/insight-agent';
export {
  buildReportDraft,
  validateReportDraft,
  buildReportDraftRevision,
  validateReportDraftRevision,
  validateDraftReportCompatibility,
  ReportAgentError,
} from './analysis-v1/agents/report-agent';
export type { ReportAgentInput, ReportRevisionAgentInput } from './analysis-v1/agents/report-agent';
export {
  loadInsightStageArtifacts,
  executeInsightStage,
  executeReportDraftStage,
  executeAgentThroughDraft,
} from './analysis-v1/stages/insight-report';
export type {
  AgentInsightStageResult,
  AgentDraftStageResult,
} from './analysis-v1/stages/insight-report';
export {
  reviewerProviderInput,
  createDeterministicReviewerProvider,
  buildReviewResult,
  validateReviewResult,
  ReviewerAgentError,
  ReviewerCorrectionRequestSchema,
} from './analysis-v1/agents/reviewer-agent';
export type {
  ReviewerCorrectionRequest,
  ReviewerProviderInput,
  ReviewerProvider,
  ReviewerAgentInput,
} from './analysis-v1/agents/reviewer-agent';
export {
  loadReportDraftStage,
  loadReviewStageArtifacts,
  executeReviewerStage,
  executeReportRevisionStage,
} from './analysis-v1/stages/reviewer';
export type { AgentDraftCheckpoint, AgentReviewStageResult } from './analysis-v1/stages/reviewer';
export {
  buildPublicationArtifact,
  executePublicationStage,
} from './analysis-v1/stages/publication';
export type {
  PublicationArtifactInput,
  PublishedAgentWorkflowResult,
} from './analysis-v1/stages/publication';
export { executeAgentWorkflow } from './analysis-v1/workflow';
export { enqueueEligibleDurableTurn } from './runtime/admission';
export type { AgentWorkflowOptions } from './analysis-v1/workflow';
export {
  isCausalQuestion,
  resolveAgentTargetFollowUpAction,
  createAnalysisTool,
  getAnalysisResultTool,
  inspectSignalTool,
  getAgentTargetFollowUp,
  cancelAnalysisTool,
  modelToolNames,
} from './chat/operations';
export type {
  AgentToolExecutionContext,
  AgentToolResult,
  AgentTargetFollowUpAction,
} from './chat/operations';
export {
  getUseCaseDefinition,
  supportsUseCaseCapability,
  getDecisionUseCasePolicy,
  useCases,
  UnknownUseCaseError,
} from './use-cases';
export type { WorkflowDag } from './analysis-v1/dag';
export { AGENT_WORKFLOW_DAG, AGENT_DATA_DAG } from './analysis-v1/dag';
export {
  executeCoordinatorAndData,
  loadCoordinatorStageArtifacts,
  loadDataStageArtifacts,
} from './analysis-v1/stages/coordinator-data';
export type { AgentDataStageResult } from './analysis-v1/stages/coordinator-data';
export {
  workflowFailureCode,
  isCurrentSuccessfulTask,
  loadStageContext,
  transitionTask,
  persistAgentStageMessage,
} from './analysis-v1/checkpoint/stage-context';
export type { StageContext } from './analysis-v1/checkpoint/stage-context';
export { persistStageArtifact } from './analysis-v1/checkpoint/artifact-store';
export type { ArtifactRefs } from './analysis-v1/checkpoint/artifact-store';
export { DAG } from './legacy-workflow/dag';
export { executeLease } from './legacy-workflow/workflow';
export { exportReport } from './legacy-workflow/export-report';

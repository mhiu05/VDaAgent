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
  createNarrativeProviders,
  GeminiProvider,
  OpenAIProvider,
  FallbackNarrativeProvider,
} from './providers/narrative';
export type { Narrative, NarrativeProvider, NarrativeContext } from './providers/narrative';
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
export { AgentRuntime } from './runtime/agent-runtime';
export { isApprovedDurableAnalysisTurn } from '@vda/contracts';
export { TeamRuntime, AgentMessageBus } from './runtime/team/executor';
export type {
  TeamRuntimeOptions,
  RegisteredAgent,
  InvocationContext,
} from './runtime/team/executor';
export { ToolRegistry, ToolRuntimeError, ToolResultSchema } from './runtime/team/tools';
export type {
  ToolDefinition,
  ToolResult,
  ToolExecutionContext,
  ToolExecutionEvent,
} from './runtime/team/tools';
export { ANALYSIS_AGENT_DEFINITIONS } from './runtime/team/definitions';
export { XaiAgentRuntimeProvider } from './runtime/providers/xai-provider';
export {
  validateVisualEvidence,
  chartPayloadFingerprint,
  ChartBuilder,
} from './analysis/chart-builder';
export {
  buildComparisonPack,
  validateComparisonPack,
  ComparisonAgentError,
} from './analysis/specialists/comparison';
export type { ComparisonAgentInput } from './analysis/specialists/comparison';
export { coordinateRun, CoordinatorError } from './analysis/specialists/coordinator';
export type { CoordinatorInput } from './analysis/specialists/coordinator';
export {
  calculateDataAgentOutput,
  buildDataAnalysisPack,
  validateDataAnalysisPack,
  DataAgentError,
} from './analysis/specialists/data';
export type {
  DataArtifactKeys,
  DataAgentArtifacts,
  DataAnalysisPackInput,
  DeterministicDataOutput,
} from './analysis/specialists/data';
export {
  buildChartEvidence,
  buildChartPack,
  validateChartPack,
  ChartAgentError,
} from './analysis/specialists/chart';
export type { ChartAgentInput, ChartPackInput } from './analysis/specialists/chart';
export {
  buildAnalysisPack,
  validateAnalysisPack,
  AnalystAgentError,
} from './analysis/specialists/analyst';
export type { AnalystAgentInput } from './analysis/specialists/analyst';
export {
  loadBranchStageArtifacts,
  executeComparisonBranch,
  executeChartBranch,
  executeAnalystBranch,
} from './analysis/stages/branches';
export type {
  ComparisonBranchResult,
  ChartBranchResult,
  AnalystBranchResult,
  AgentBranchStageResult,
  PersistedAgentBranchStageResult,
} from './analysis/stages/branches';
export {
  buildLegacyInsightPayload,
  buildInsightPack,
  validateInsightPack,
  InsightAgentError,
} from './analysis/specialists/insight';
export type {
  InsightNarrative,
  InsightSourceInput,
  InsightAgentInput,
} from './analysis/specialists/insight';
export {
  buildReportDraft,
  validateReportDraft,
  buildReportDraftRevision,
  validateReportDraftRevision,
  validateDraftReportCompatibility,
  ReportAgentError,
} from './analysis/specialists/report';
export type { ReportAgentInput, ReportRevisionAgentInput } from './analysis/specialists/report';
export {
  loadInsightStageArtifacts,
  executeInsightStage,
  executeReportDraftStage,
} from './analysis/stages/insight-report';
export type {
  AgentInsightStageResult,
  AgentDraftStageResult,
} from './analysis/stages/insight-report';
export {
  reviewerProviderInput,
  createDeterministicReviewerProvider,
  buildReviewResult,
  validateReviewResult,
  ReviewerAgentError,
  ReviewerCorrectionRequestSchema,
} from './analysis/specialists/reviewer';
export type {
  ReviewerCorrectionRequest,
  ReviewerProviderInput,
  ReviewerProvider,
  ReviewerAgentInput,
} from './analysis/specialists/reviewer';
export {
  loadReportDraftStage,
  loadReviewStageArtifacts,
  executeReviewerStage,
  executeReportRevisionStage,
} from './analysis/stages/reviewer';
export type { AgentDraftCheckpoint, AgentReviewStageResult } from './analysis/stages/reviewer';
export { buildPublicationArtifact, executePublicationStage } from './analysis/stages/publication';
export type {
  PublicationArtifactInput,
  PublishedAgentWorkflowResult,
} from './analysis/stages/publication';
export { executeAgentWorkflow } from './analysis/workflow';
export { enqueueEligibleDurableTurn } from './runtime/admission';
export type { AgentWorkflowOptions } from './analysis/workflow';
export {
  isCausalQuestion,
  resolveAgentTargetFollowUpAction,
  createAnalysisTool,
  getAnalysisResultTool,
  inspectSignalTool,
  getAgentTargetFollowUp,
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
export type { WorkflowDag } from './analysis/dag';
export { AGENT_WORKFLOW_DAG } from './analysis/dag';
export {
  executeCoordinatorAndData,
  loadCoordinatorStageArtifacts,
  loadDataStageArtifacts,
} from './analysis/stages/coordinator-data';
export type { AgentDataStageResult } from './analysis/stages/coordinator-data';
export {
  workflowFailureCode,
  isCurrentSuccessfulTask,
  loadStageContext,
  transitionTask,
  persistAgentStageMessage,
} from './analysis/checkpoint/stage-context';
export type { StageContext } from './analysis/checkpoint/stage-context';
export { persistStageArtifact } from './analysis/checkpoint/artifact-store';
export type { ArtifactRefs } from './analysis/checkpoint/artifact-store';

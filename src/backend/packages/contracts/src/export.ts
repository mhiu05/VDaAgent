import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { AnalysisRequestSchema } from './analysis/request';
import {
  AnalysisPackSchema,
  ChartPackSchema,
  ComparisonPackSchema,
  CoordinatorDecisionSchema,
  DataAnalysisPackSchema,
  DecisionIntelligencePackSchema,
  InsightPackSchema,
  ReportDraftSchema,
  ReviewResultSchema,
} from './agents/workflow-packs';
import { AgentActivityEventV1Schema, AgentTurnStreamEventV1Schema } from './runtime/activity';
import { AgentPlanV1Schema, GroundedResponseSelectionV1Schema } from './runtime/plan';
import { AgentTurnRequestSchema } from './chat/message';
import { AgentWorkflowStatusSchema, DecisionIntelligenceResponseSchema } from './api/responses';
import {
  AvailableWorkspaceActionV1Schema,
  CapabilityResultV1Schema,
  CanonicalAgentObservationV1Schema,
} from './runtime/capabilities';
import { ArtifactSchema } from './artifacts/artifact';
import {
  ContextResolutionIssueV1Schema,
  WorkspaceActionV1Schema,
  WorkspaceContextV1Schema,
} from './runtime/context';
import { ReportDefinitionSchema } from './reports/schedule';
import { RunSchema } from './analysis/run';
import { SnapshotRowSchema } from './imports/inventory';
import { AgentDefinitionSchema, MessageContextRefSchema, MemoryEntrySchema,
  RuntimeActivityEventSchema, RunRuntimeSnapshotSchema, ThreadContextSchema } from './runtime/workspace';
await mkdir('src/backend/packages/contracts/schema', { recursive: true });
for (const [name, schema] of Object.entries({
  AnalysisRequest: AnalysisRequestSchema,
  AnalysisPack: AnalysisPackSchema,
  AgentActivityEventV1: AgentActivityEventV1Schema,
  AgentPlanV1: AgentPlanV1Schema,
  AgentTurnRequest: AgentTurnRequestSchema,
  AgentTurnStreamEventV1: AgentTurnStreamEventV1Schema,
  AgentWorkflowStatus: AgentWorkflowStatusSchema,
  AvailableWorkspaceActionV1: AvailableWorkspaceActionV1Schema,
  Artifact: ArtifactSchema,
  CapabilityResultV1: CapabilityResultV1Schema,
  CanonicalAgentObservationV1: CanonicalAgentObservationV1Schema,
  ChartPack: ChartPackSchema,
  ComparisonPack: ComparisonPackSchema,
  ContextResolutionIssueV1: ContextResolutionIssueV1Schema,
  CoordinatorDecision: CoordinatorDecisionSchema,
  DataAnalysisPack: DataAnalysisPackSchema,
  DecisionIntelligencePack: DecisionIntelligencePackSchema,
  DecisionIntelligenceResponse: DecisionIntelligenceResponseSchema,
  GroundedResponseSelectionV1: GroundedResponseSelectionV1Schema,
  InsightPack: InsightPackSchema,
  ReportDraft: ReportDraftSchema,
  ReportDefinition: ReportDefinitionSchema,
  ReviewResult: ReviewResultSchema,
  Run: RunSchema,
  SnapshotRow: SnapshotRowSchema,
  WorkspaceActionV1: WorkspaceActionV1Schema,
  WorkspaceContextV1: WorkspaceContextV1Schema,
  AgentDefinition: AgentDefinitionSchema,
  MessageContextRef: MessageContextRefSchema,
  MemoryEntry: MemoryEntrySchema,
  RuntimeActivityEvent: RuntimeActivityEventSchema,
  RunRuntimeSnapshot: RunRuntimeSnapshotSchema,
  ThreadContext: ThreadContextSchema,
})) {
  await writeFile(
    `src/backend/packages/contracts/schema/${name}.json`,
    `${JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any' }), null, 2)}\n`,
  );
}

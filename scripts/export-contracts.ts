import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AnalysisRequestSchema } from '../src/contracts/analysis/request';
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
} from '../src/contracts/agents/workflow-packs';
import {
  AgentActivityEventV1Schema,
  AgentTurnStreamEventV1Schema,
} from '../src/contracts/runtime/activity';
import {
  AgentPlanV1Schema,
  GroundedResponseSelectionV1Schema,
} from '../src/contracts/runtime/plan';
import { AgentTurnRequestSchema } from '../src/contracts/chat/message';
import {
  AgentWorkflowStatusSchema,
  DecisionIntelligenceResponseSchema,
} from '../src/contracts/api/responses';
import {
  AvailableWorkspaceActionV1Schema,
  CapabilityResultV1Schema,
  CanonicalAgentObservationV1Schema,
} from '../src/contracts/runtime/capabilities';
import { ArtifactSchema } from '../src/contracts/artifacts/artifact';
import {
  ContextResolutionIssueV1Schema,
  WorkspaceActionV1Schema,
  WorkspaceContextV1Schema,
} from '../src/contracts/runtime/context';
import { ReportDefinitionSchema } from '../src/contracts/reports/schedule';
import { RunSchema } from '../src/contracts/analysis/run';
import { SnapshotRowSchema } from '../src/contracts/imports/inventory';
import {
  AgentDefinitionSchema,
  MessageContextRefSchema,
  MemoryEntrySchema,
  RuntimeActivityEventSchema,
  RunRuntimeSnapshotSchema,
  ThreadContextSchema,
} from '../src/contracts/runtime/workspace';
const schemaRoot = fileURLToPath(new URL('../src/contracts/schema/', import.meta.url));
await mkdir(schemaRoot, { recursive: true });
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
    resolve(schemaRoot, `${name}.json`),
    `${JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any' }), null, 2)}\n`,
  );
}

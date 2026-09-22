import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  AnalysisRequestSchema,
  AnalysisPackSchema,
  AgentWorkflowStatusSchema,
  ArtifactSchema,
  ChartPackSchema,
  ComparisonPackSchema,
  CoordinatorDecisionSchema,
  DataAnalysisPackSchema,
  DecisionIntelligencePackSchema,
  DecisionIntelligenceResponseSchema,
  InsightPackSchema,
  ReportDraftSchema,
  ReportDefinitionSchema,
  ReviewResultSchema,
  RunSchema,
  SnapshotRowSchema,
} from './index';
await mkdir('src/backend/packages/contracts/schema', { recursive: true });
for (const [name, schema] of Object.entries({
  AnalysisRequest: AnalysisRequestSchema,
  AnalysisPack: AnalysisPackSchema,
  AgentWorkflowStatus: AgentWorkflowStatusSchema,
  Artifact: ArtifactSchema,
  ChartPack: ChartPackSchema,
  ComparisonPack: ComparisonPackSchema,
  CoordinatorDecision: CoordinatorDecisionSchema,
  DataAnalysisPack: DataAnalysisPackSchema,
  DecisionIntelligencePack: DecisionIntelligencePackSchema,
  DecisionIntelligenceResponse: DecisionIntelligenceResponseSchema,
  InsightPack: InsightPackSchema,
  ReportDraft: ReportDraftSchema,
  ReportDefinition: ReportDefinitionSchema,
  ReviewResult: ReviewResultSchema,
  Run: RunSchema,
  SnapshotRow: SnapshotRowSchema,
})) {
  await writeFile(
    `src/backend/packages/contracts/schema/${name}.json`,
    `${JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any' }), null, 2)}\n`,
  );
}

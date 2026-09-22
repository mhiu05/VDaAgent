import {
  ReviewResultSchema,
  type AnalysisRun,
  type Artifact,
  type ArtifactOf,
  type ReviewIssue,
  type ReviewResult,
  type WorkflowPackMetadata,
} from '@vda/contracts';
import {
  AgentWorkflowValidationError,
  canonical,
  EVIDENCE_BOUND_REVISION_CORRECTION,
  EVIDENCE_BOUND_REVISION_MESSAGE,
  readArtifactPath,
  reviewResultForDraft,
  validateReportDraftArtifact,
  validateReviewResultArtifact,
  verifyArtifact,
} from '@vda/domain';
import { z } from 'zod';
import { validateAnalysisPack } from './analyst-agent';
import { validateChartPack } from './chart-agent';
import { validateComparisonPack } from './comparison-agent';
import { validateDataAnalysisPack } from './data-agent';
import { stableId } from './integrity';
import { validateInsightPack } from './insight-agent';
import {
  ReportAgentError,
  buildReportDraft,
  validateReportDraft,
  type ReportAgentInput,
} from './report-agent';

export class ReviewerAgentError extends Error {
  constructor(readonly code: 'REVIEWER_AGENT_INPUT_INVALID' | 'REVIEWER_AGENT_OUTPUT_INVALID') {
    super(code);
  }
}

/**
 * A deliberately narrow, server-originated correction instruction. Its
 * content is fixed here; callers cannot inject ungrounded reviewer prose or
 * point the reviewer at an arbitrary artifact.
 */
export const ReviewerCorrectionRequestSchema = z
  .object({
    code: z.literal('REQUIRE_EVIDENCE_BOUND_WORDING'),
    claim_id: z.string().trim().min(1).max(500),
  })
  .strict();
export type ReviewerCorrectionRequest = z.infer<typeof ReviewerCorrectionRequestSchema>;

/**
 * The provider boundary is intentionally narrower than a ReviewResult. It can
 * request one of the server-defined, evidence-bound corrections, but cannot
 * supply a PASS, rewrite a claim, or introduce a metric/chart fact.
 */
export type ReviewerProviderInput = {
  run_id: string;
  draft_id: string;
  draft_revision: number;
  claims: ReadonlyArray<{
    claim_id: string;
    evidence_artifact_id: string;
    evidence_path: string;
  }>;
};

export interface ReviewerProvider {
  review(input: ReviewerProviderInput): Promise<ReviewerCorrectionRequest | null>;
}

export type ReviewerAgentInput = {
  run: AnalysisRun;
  report_draft: ArtifactOf<'report_draft'>;
  /** The complete persisted run graph, read under the caller's authorization. */
  artifacts: Artifact[];
  correction?: ReviewerCorrectionRequest | null;
};

export function reviewerProviderInput(input: ReviewerAgentInput): ReviewerProviderInput {
  return {
    run_id: input.run.run_id,
    draft_id: input.report_draft.payload.draft_id,
    draft_revision: input.report_draft.payload.revision,
    claims: input.report_draft.payload.report.claims.map((claim) => ({
      claim_id: claim.claim_id,
      evidence_artifact_id: claim.evidence_artifact_id,
      evidence_path: claim.evidence_path,
    })),
  };
}

/** The normal reviewer is deterministic; callers may inject a bounded adapter. */
export function createDeterministicReviewerProvider(): ReviewerProvider {
  return { review: async () => null };
}

type ResolvedReviewerInput = {
  input: ReviewerAgentInput;
  byId: Map<string, Artifact>;
  reportInput: ReportAgentInput;
};

const sameIds = (actual: readonly string[], expected: readonly string[]) =>
  canonical([...new Set(actual)].sort()) === canonical([...new Set(expected)].sort());

function inputInvalid(): never {
  throw new ReviewerAgentError('REVIEWER_AGENT_INPUT_INVALID');
}

function requiredArtifact<K extends Artifact['kind']>(
  byId: Map<string, Artifact>,
  id: string,
  kind: K,
): Extract<Artifact, { kind: K }> {
  const artifact = byId.get(id);
  if (!artifact || artifact.kind !== kind) inputInvalid();
  return artifact as Extract<Artifact, { kind: K }>;
}

function inputArtifactOfKind<K extends Artifact['kind']>(
  artifact: Artifact,
  byId: Map<string, Artifact>,
  kind: K,
): Extract<Artifact, { kind: K }> {
  const matches = artifact.input_refs
    .map((id) => byId.get(id))
    .filter((candidate): candidate is Extract<Artifact, { kind: K }> => candidate?.kind === kind);
  if (matches.length !== 1) inputInvalid();
  return matches[0];
}

function assertPackMetadata(
  artifact: Artifact,
  metadata: WorkflowPackMetadata,
  run: AnalysisRun,
): void {
  if (
    artifact.org_id !== run.org_id ||
    artifact.run_id !== run.run_id ||
    artifact.data_as_of !== run.request.data_as_of ||
    metadata.org_id !== run.org_id ||
    metadata.run_id !== run.run_id ||
    metadata.use_case !== run.request.use_case ||
    canonical(metadata.scope) !== canonical(run.request.scope) ||
    metadata.data_as_of !== run.request.data_as_of ||
    metadata.semantic_version !== artifact.semantic_version ||
    !sameIds(metadata.input_refs, artifact.input_refs) ||
    !sameIds(metadata.snapshot_refs, artifact.snapshot_refs) ||
    !sameIds(metadata.source_refs, artifact.source_refs)
  )
    inputInvalid();
}

/**
 * Rehydrates the report's fixed canonical inputs from the persisted graph and
 * reruns each existing deterministic validator. A Reviewer never accepts
 * caller-provided metric, chart, or lineage values as a substitute.
 */
function resolveInput(input: ReviewerAgentInput): ResolvedReviewerInput {
  if (input.run.workflow_version !== 'agent-v1') inputInvalid();
  const byId = new Map<string, Artifact>();
  try {
    for (const artifact of input.artifacts) {
      if (byId.has(artifact.artifact_id)) inputInvalid();
      verifyArtifact(artifact);
      if (
        artifact.org_id !== input.run.org_id ||
        artifact.run_id !== input.run.run_id ||
        artifact.data_as_of !== input.run.request.data_as_of
      )
        inputInvalid();
      byId.set(artifact.artifact_id, artifact);
    }
    const persistedDraft = byId.get(input.report_draft.artifact_id);
    verifyArtifact(input.report_draft);
    if (!persistedDraft || canonical(persistedDraft) !== canonical(input.report_draft))
      inputInvalid();
  } catch (error) {
    if (error instanceof ReviewerAgentError) throw error;
    inputInvalid();
  }

  const draft = input.report_draft;
  const data = requiredArtifact(
    byId,
    draft.payload.data_analysis_pack_artifact_id,
    'data_analysis_pack',
  );
  const comparisonPack = requiredArtifact(
    byId,
    draft.payload.comparison_pack_artifact_id,
    'comparison_pack',
  );
  const chartPack = requiredArtifact(byId, draft.payload.chart_pack_artifact_id, 'chart_pack');
  const analysisPack = requiredArtifact(
    byId,
    draft.payload.analysis_pack_artifact_id,
    'analysis_pack',
  );
  const insightPack = requiredArtifact(
    byId,
    draft.payload.insight_pack_artifact_id,
    'insight_pack',
  );
  const decisionIntelligencePack = draft.payload.decision_intelligence_artifact_id
    ? requiredArtifact(
        byId,
        draft.payload.decision_intelligence_artifact_id,
        'decision_intelligence_pack',
      )
    : undefined;
  const query = requiredArtifact(byId, data.payload.dataset.query_artifact_id, 'query');
  const queryResult = requiredArtifact(
    byId,
    data.payload.dataset.query_result_artifact_id,
    'query_result',
  );
  const calculation = requiredArtifact(
    byId,
    data.payload.dataset.calculation_artifact_id,
    'calculation',
  );
  const comparisonCalculation = requiredArtifact(
    byId,
    data.payload.dataset.comparison_calculation_artifact_id,
    'comparison_calculation',
  );
  const comparison = requiredArtifact(
    byId,
    data.payload.dataset.comparison_artifact_id,
    'comparison',
  );
  const visualEvidence = inputArtifactOfKind(chartPack, byId, 'visual_evidence');
  const insight = inputArtifactOfKind(insightPack, byId, 'insight');

  try {
    for (const artifact of [
      data,
      comparisonPack,
      chartPack,
      analysisPack,
      insightPack,
      ...(decisionIntelligencePack ? [decisionIntelligencePack] : []),
    ])
      assertPackMetadata(artifact, artifact.payload, input.run);
    validateDataAnalysisPack(data.payload, {
      run: input.run,
      query,
      query_result: queryResult,
      calculation,
      comparison_calculation: comparisonCalculation,
      comparison,
      artifact_keys: {
        query: 'data.query',
        query_result: 'data.query_result',
        calculation: 'data.calculation',
        comparison_calculation: 'data.comparison_calculation',
        comparison: 'data.comparison',
      },
    });
    validateComparisonPack(comparisonPack.payload, {
      data_analysis_pack: data,
      data_analysis_pack_key: 'data_analysis_pack',
    });
    validateChartPack(chartPack.payload, {
      data_analysis_pack: data,
      calculation,
      comparison,
      visual_evidence: visualEvidence,
      keys: {
        data_analysis_pack: 'data_analysis_pack',
        calculation: 'data.calculation',
        comparison: 'data.comparison',
        visual_evidence: 'chart.visual_evidence',
      },
    });
    validateAnalysisPack(analysisPack.payload, {
      data_analysis_pack: data,
      data_analysis_pack_key: 'data_analysis_pack',
    });
    validateInsightPack(insightPack.payload, {
      data_analysis_pack: data,
      calculation,
      comparison,
      comparison_pack: comparisonPack,
      visual_evidence: visualEvidence,
      chart_pack: chartPack,
      analysis_pack: analysisPack,
      insight,
      keys: {
        data_analysis_pack: 'data_analysis_pack',
        calculation: 'data.calculation',
        comparison: 'data.comparison',
        comparison_pack: 'comparison_pack',
        visual_evidence: 'chart.visual_evidence',
        chart_pack: 'chart_pack',
        analysis_pack: 'analysis_pack',
        insight: 'insight',
      },
    });
  } catch {
    inputInvalid();
  }

  return {
    input,
    byId,
    reportInput: {
      run: input.run,
      data_analysis_pack: data,
      calculation,
      comparison,
      comparison_pack: comparisonPack,
      visual_evidence: visualEvidence,
      chart_pack: chartPack,
      analysis_pack: analysisPack,
      insight,
      insight_pack: insightPack,
      ...(decisionIntelligencePack
        ? { decision_intelligence_pack: decisionIntelligencePack }
        : {}),
    },
  };
}

function draftIssue(draft: ArtifactOf<'report_draft'>): ReviewIssue {
  return {
    issue_id: stableId(`${draft.artifact_id}:draft-canonical-projection`),
    severity: 'blocking',
    category: 'evidence',
    claim_id: null,
    message: 'The draft is not an exact, validated projection of the canonical artifacts.',
    required_correction:
      'Rebuild this draft from the validated Report Agent inputs without changing metrics, claims, charts, scope, date, or evidence bindings.',
    evidence_refs: [
      {
        artifact_id: draft.artifact_id,
        artifact_key: `report_draft:${draft.payload.revision}`,
        path: 'payload.report',
      },
    ],
  };
}

function correctionIssue(
  correction: ReviewerCorrectionRequest,
  draft: ArtifactOf<'report_draft'>,
  byId: Map<string, Artifact>,
): ReviewIssue {
  const request = ReviewerCorrectionRequestSchema.parse(correction);
  const claim = draft.payload.report.claims.find(
    (candidate) => candidate.claim_id === request.claim_id,
  );
  if (!claim) inputInvalid();
  const evidenceArtifact = byId.get(claim.evidence_artifact_id);
  if (!evidenceArtifact) inputInvalid();
  try {
    readArtifactPath(evidenceArtifact, claim.evidence_path);
  } catch {
    inputInvalid();
  }
  return {
    issue_id: stableId(`${draft.artifact_id}:evidence-bound-wording:${claim.claim_id}`),
    severity: 'blocking',
    category: 'overstatement',
    claim_id: claim.claim_id,
    message: EVIDENCE_BOUND_REVISION_MESSAGE,
    required_correction: EVIDENCE_BOUND_REVISION_CORRECTION,
    evidence_refs: [
      {
        artifact_id: claim.evidence_artifact_id,
        artifact_key: 'data.calculation',
        path: claim.evidence_path,
      },
    ],
  };
}

function isDraftDefect(error: unknown): boolean {
  if (error instanceof ReportAgentError) return error.code === 'REPORT_AGENT_OUTPUT_INVALID';
  if (!(error instanceof AgentWorkflowValidationError)) return false;
  return new Set([
    'INVALID_DRAFT_METADATA',
    'INVALID_DRAFT_IDENTITY',
    'INVALID_DRAFT_PACK_INPUT',
    'INVALID_DRAFT_INPUTS',
    'INVALID_DRAFT_REVISION_INPUT',
    'INVALID_EVIDENCE_LINEAGE',
    'INVALID_EVIDENCE_PATH',
    'INVALID_REPORT_REFERENCES',
    'REPORT_RECALCULATED_OR_CHANGED',
    'UNGROUNDED_CLAIM',
    'UNVALIDATED_NARRATIVE',
    'INVALID_CHART_LINEAGE',
    'INVALID_CHART_VALUES',
    'INVALID_COMPARISON_LINEAGE',
    'INVALID_TYPED_COMPARISON',
    'INVALID_INSIGHT_LINEAGE',
    'INVALID_REPORT_SECTION',
    'INVALID_DECISION_BRIEF',
    'REPORT_AGENT_PROJECTION_CHANGED',
  ]).has(error.code);
}

function validateDraftProjection(resolved: ResolvedReviewerInput): void {
  const { input, reportInput, byId } = resolved;
  const draft = input.report_draft;
  validateReportDraftArtifact(draft, input.artifacts, input.run);
  if (draft.payload.revision === 1) {
    validateReportDraft(draft.payload, reportInput);
    return;
  }

  // Revision two is intentionally bounded: it must name the prior blocking
  // review, and it cannot introduce a second set of report facts or prose.
  const priorReview = inputArtifactOfKind(draft, byId, 'review_result');
  const priorDraft = requiredArtifact(byId, priorReview.payload.draft_artifact_id, 'report_draft');
  try {
    validateReviewResultArtifact(priorReview, priorDraft, input.artifacts, input.run);
  } catch {
    inputInvalid();
  }
  const expected = buildReportDraft(reportInput);
  if (canonical(draft.payload.report) !== canonical(expected.report))
    throw new ReportAgentError('REPORT_AGENT_OUTPUT_INVALID');
}

function reviewIssues(resolved: ResolvedReviewerInput): ReviewIssue[] {
  const { input } = resolved;
  try {
    // The domain validator protects the graph; the exact projection check
    // rejects otherwise schema-valid prose or factual drift in either of the
    // two permitted draft revisions.
    validateDraftProjection(resolved);
  } catch (error) {
    if (!isDraftDefect(error)) inputInvalid();
    return [draftIssue(input.report_draft)];
  }
  return input.correction
    ? [correctionIssue(input.correction, input.report_draft, resolved.byId)]
    : [];
}

function expectedReview(input: ReviewerAgentInput): ReviewResult {
  const resolved = resolveInput(input);
  const draft = resolved.input.report_draft;
  const issues = reviewIssues(resolved);
  return ReviewResultSchema.parse({
    contract_version: 'review-result-v1',
    pack_id: stableId(`${input.run.run_id}:review-result:${draft.payload.revision}`),
    run_id: input.run.run_id,
    org_id: input.run.org_id,
    use_case: input.run.request.use_case,
    use_case_version: draft.payload.use_case_version,
    scope: input.run.request.scope,
    data_as_of: input.run.request.data_as_of,
    semantic_version: draft.semantic_version,
    input_refs: [draft.artifact_id],
    snapshot_refs: draft.snapshot_refs,
    source_refs: draft.source_refs,
    limitations: draft.payload.limitations,
    review_id: stableId(`${input.run.run_id}:review:${draft.payload.revision}`),
    draft_artifact_id: draft.artifact_id,
    draft_id: draft.payload.draft_id,
    draft_revision: draft.payload.revision,
    draft_content_hash: draft.content_hash,
    status: issues.length ? 'REVISION_REQUIRED' : 'PASS',
    issues,
    summary: issues.length
      ? `Draft revision ${draft.payload.revision} requires the listed corrections before publication.`
      : `Draft revision ${draft.payload.revision} passed deterministic evidence, metric, chart, scope, and limitation checks.`,
    provider: 'deterministic',
  });
}

/**
 * Produces only a deterministic decision. The result is not a publication
 * authority; the fenced publication gate must validate the persisted review
 * against this exact draft hash again.
 */
export function buildReviewResult(input: ReviewerAgentInput): ReviewResult {
  return expectedReview(input);
}

export function validateReviewResult(result: ReviewResult, input: ReviewerAgentInput): void {
  const parsed = ReviewResultSchema.parse(result);
  const expected = expectedReview(input);
  if (
    !reviewResultForDraft(parsed, input.report_draft) ||
    canonical(parsed) !== canonical(expected)
  )
    throw new ReviewerAgentError('REVIEWER_AGENT_OUTPUT_INVALID');
}

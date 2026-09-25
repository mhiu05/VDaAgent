import {
  ReportDraftSchema,
  type AnalysisRun,
  type Artifact,
  type ArtifactOf,
  type CanonicalEvidenceRef,
  type ReportDraft,
  type ReportPayload,
  type ReviewResult,
  type WorkflowPackMetadata,
} from '@vda/contracts';
import {
  projectDecisionBriefV1Compatibility,
  readArtifactPath,
  validateDecisionIntelligencePack,
} from '@vda/domain';
import { buildDecisionBrief } from '@vda/semantic';
import { validateInsightPack, type InsightAgentInput } from './insight-agent';
import { canonical, stableId, validateReport, verifyArtifact } from '@vda/domain';
import { reportSections } from '@vda/domain';
import { getDecisionUseCasePolicy } from '../../use-cases';

export class ReportAgentError extends Error {
  constructor(readonly code: 'REPORT_AGENT_INPUT_INVALID' | 'REPORT_AGENT_OUTPUT_INVALID') {
    super(code);
  }
}

export type ReportAgentInput = InsightAgentInput & {
  run: AnalysisRun;
  insight_pack: ArtifactOf<'insight_pack'>;
  /** Optional only for validating historical test/legacy draft inputs. New workflow runs require it. */
  decision_intelligence_pack?: ArtifactOf<'decision_intelligence_pack'>;
};

/**
 * The sole permitted revision path. A second draft keeps the validated report
 * projection immutable and records the one blocking review that required it.
 * It never accepts free-form replacement content.
 */
export type ReportRevisionAgentInput = ReportAgentInput & {
  previous_draft: ArtifactOf<'report_draft'>;
  review_result: ArtifactOf<'review_result'>;
};

type ResolvedReportInput = {
  input: ReportAgentInput;
  report: ReportPayload;
};

function metadataMatches(
  artifact: Artifact,
  metadata: WorkflowPackMetadata,
  expected: ArtifactOf<'data_analysis_pack'>['payload'],
): boolean {
  return (
    artifact.org_id === expected.org_id &&
    artifact.run_id === expected.run_id &&
    artifact.data_as_of === expected.data_as_of &&
    artifact.semantic_version === expected.semantic_version &&
    metadata.org_id === expected.org_id &&
    metadata.run_id === expected.run_id &&
    metadata.use_case === expected.use_case &&
    metadata.use_case_version === expected.use_case_version &&
    metadata.data_as_of === expected.data_as_of &&
    metadata.semantic_version === expected.semantic_version &&
    canonical(metadata.scope) === canonical(expected.scope) &&
    canonical(metadata.snapshot_refs) === canonical(expected.snapshot_refs) &&
    canonical(metadata.source_refs) === canonical(expected.source_refs)
  );
}

/** Preserves the established final-report serializer shape inside a draft. */
function legacyCompatibleReport(input: ReportAgentInput): ReportPayload {
  const { run, calculation, comparison, visual_evidence: chart, insight } = input;
  return {
    title: `Inventory report \u00c2\u00b7 ${run.request.scope.zone_external_id ?? run.request.scope.project_external_id}`,
    summary: insight.payload.summary,
    claims: insight.payload.claims,
    metrics: calculation.payload.metrics,
    units: calculation.payload.units,
    calculation_artifact_id: calculation.artifact_id,
    chart_artifact_id: chart.artifact_id,
    comparison_artifact_id: comparison.artifact_id,
    sections: reportSections(calculation, chart, comparison, insight),
    limitations: [...calculation.limitations, ...calculation.payload.quality_limitations],
    decision_brief: input.decision_intelligence_pack
      ? projectDecisionBriefV1Compatibility({
          ...input,
          policy: getDecisionUseCasePolicy(
            run.request.use_case,
            input.decision_intelligence_pack.payload.use_case_version,
          ),
        })
      : buildDecisionBrief(
          calculation.payload,
          calculation.artifact_id,
          run.request.scope,
          run.request.data_as_of,
        ),
    ...(input.decision_intelligence_pack
      ? { decision_intelligence_artifact_id: input.decision_intelligence_pack.artifact_id }
      : {}),
  };
}

function resolveInput(input: ReportAgentInput): ResolvedReportInput {
  const data = input.data_analysis_pack.payload;
  verifyArtifact(input.insight_pack);
  if (
    input.run.org_id !== data.org_id ||
    input.run.run_id !== data.run_id ||
    input.run.request.use_case !== data.use_case ||
    canonical(input.run.request.scope) !== canonical(data.scope) ||
    input.run.request.data_as_of !== data.data_as_of ||
    !metadataMatches(input.insight_pack, input.insight_pack.payload, data)
  )
    throw new ReportAgentError('REPORT_AGENT_INPUT_INVALID');
  try {
    validateInsightPack(input.insight_pack.payload, input);
    if (input.decision_intelligence_pack)
      validateDecisionIntelligencePack(input.decision_intelligence_pack.payload, {
        ...input,
        policy: getDecisionUseCasePolicy(
          input.run.request.use_case,
          input.decision_intelligence_pack.payload.use_case_version,
        ),
      });
  } catch {
    throw new ReportAgentError('REPORT_AGENT_INPUT_INVALID');
  }
  return { input, report: legacyCompatibleReport(input) };
}

function evidence(artifact: Artifact, artifactKey: string, path: string): CanonicalEvidenceRef {
  try {
    readArtifactPath(artifact, path);
  } catch {
    throw new ReportAgentError('REPORT_AGENT_OUTPUT_INVALID');
  }
  return { artifact_id: artifact.artifact_id, artifact_key: artifactKey, path };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueEvidence(values: CanonicalEvidenceRef[]): CanonicalEvidenceRef[] {
  const byKey = new Map(
    values.map((value) => [`${value.artifact_id}:${value.artifact_key}:${value.path}`, value]),
  );
  return [...byKey.values()].sort((left, right) =>
    `${left.artifact_id}:${left.artifact_key}:${left.path}`.localeCompare(
      `${right.artifact_id}:${right.artifact_key}:${right.path}`,
    ),
  );
}

function expectedDraft(input: ReportAgentInput): ReportDraft {
  const { input: resolved, report } = resolveInput(input);
  const data = resolved.data_analysis_pack.payload;
  return ReportDraftSchema.parse({
    contract_version: 'report-draft-v1',
    pack_id: stableId(`${data.run_id}:report-draft:1`),
    run_id: data.run_id,
    org_id: data.org_id,
    use_case: data.use_case,
    use_case_version: data.use_case_version,
    scope: data.scope,
    data_as_of: data.data_as_of,
    semantic_version: data.semantic_version,
    input_refs: [
      resolved.data_analysis_pack.artifact_id,
      resolved.comparison_pack.artifact_id,
      resolved.chart_pack.artifact_id,
      resolved.analysis_pack.artifact_id,
      resolved.insight_pack.artifact_id,
      ...(resolved.decision_intelligence_pack
        ? [resolved.decision_intelligence_pack.artifact_id]
        : []),
    ].sort(),
    snapshot_refs: data.snapshot_refs,
    source_refs: data.source_refs,
    limitations: unique(report.limitations),
    draft_id: stableId(`${data.run_id}:report-draft`),
    revision: 1,
    data_analysis_pack_artifact_id: resolved.data_analysis_pack.artifact_id,
    comparison_pack_artifact_id: resolved.comparison_pack.artifact_id,
    chart_pack_artifact_id: resolved.chart_pack.artifact_id,
    analysis_pack_artifact_id: resolved.analysis_pack.artifact_id,
    insight_pack_artifact_id: resolved.insight_pack.artifact_id,
    ...(resolved.decision_intelligence_pack
      ? { decision_intelligence_artifact_id: resolved.decision_intelligence_pack.artifact_id }
      : {}),
    report,
    evidence_refs: [
      evidence(resolved.data_analysis_pack, 'data_analysis_pack', 'payload.metrics'),
      evidence(resolved.comparison_pack, 'comparison_pack', 'payload.comparisons'),
      evidence(resolved.chart_pack, 'chart_pack', 'payload.charts'),
      evidence(resolved.analysis_pack, 'analysis_pack', 'payload.findings'),
      evidence(resolved.insight_pack, 'insight_pack', 'payload.claims'),
      evidence(resolved.calculation, 'data.calculation', 'payload.metrics'),
      evidence(resolved.comparison, 'data.comparison', 'payload.items'),
      evidence(resolved.visual_evidence, 'chart.visual_evidence', 'payload.charts'),
      evidence(resolved.insight, 'insight', 'payload.claims'),
      ...(resolved.decision_intelligence_pack
        ? [
            evidence(
              resolved.decision_intelligence_pack,
              'decision_intelligence_pack',
              'payload.decision_brief',
            ),
          ]
        : []),
    ],
  });
}

/** Creates revision 1 only; the bounded revision path is added with Reviewer in Phase F. */
export function buildReportDraft(input: ReportAgentInput): ReportDraft {
  return expectedDraft(input);
}

export function validateReportDraft(draft: ReportDraft, input: ReportAgentInput): void {
  const parsed = ReportDraftSchema.parse(draft);
  if (canonical(parsed) !== canonical(expectedDraft(input)))
    throw new ReportAgentError('REPORT_AGENT_OUTPUT_INVALID');
}

function validRevisionReview(
  review: ArtifactOf<'review_result'>,
  prior: ArtifactOf<'report_draft'>,
  input: ReportAgentInput,
): ReviewResult {
  verifyArtifact(review);
  verifyArtifact(prior);
  const parsed = review.payload;
  const expected = input.data_analysis_pack.payload;
  if (
    prior.payload.revision !== 1 ||
    review.org_id !== expected.org_id ||
    review.run_id !== expected.run_id ||
    review.data_as_of !== expected.data_as_of ||
    !metadataMatches(review, parsed, expected) ||
    parsed.status !== 'REVISION_REQUIRED' ||
    parsed.review_id !== stableId(`${expected.run_id}:review:1`) ||
    parsed.pack_id !== stableId(`${expected.run_id}:review-result:1`) ||
    parsed.draft_artifact_id !== prior.artifact_id ||
    parsed.draft_id !== prior.payload.draft_id ||
    parsed.draft_revision !== 1 ||
    parsed.draft_content_hash !== prior.content_hash ||
    canonical(review.input_refs) !== canonical([prior.artifact_id])
  )
    throw new ReportAgentError('REPORT_AGENT_INPUT_INVALID');
  return parsed;
}

function expectedRevisionDraft(input: ReportRevisionAgentInput): ReportDraft {
  const { input: resolved, report } = resolveInput(input);
  const data = resolved.data_analysis_pack.payload;
  try {
    validateReportDraft(input.previous_draft.payload, resolved);
  } catch {
    throw new ReportAgentError('REPORT_AGENT_INPUT_INVALID');
  }
  const review = validRevisionReview(input.review_result, input.previous_draft, resolved);
  const inputRefs = [
    resolved.data_analysis_pack.artifact_id,
    resolved.comparison_pack.artifact_id,
    resolved.chart_pack.artifact_id,
    resolved.analysis_pack.artifact_id,
    resolved.insight_pack.artifact_id,
    ...(resolved.decision_intelligence_pack
      ? [resolved.decision_intelligence_pack.artifact_id]
      : []),
    input.review_result.artifact_id,
  ].sort();
  return ReportDraftSchema.parse({
    contract_version: 'report-draft-v1',
    pack_id: stableId(`${data.run_id}:report-draft:2`),
    run_id: data.run_id,
    org_id: data.org_id,
    use_case: data.use_case,
    use_case_version: data.use_case_version,
    scope: data.scope,
    data_as_of: data.data_as_of,
    semantic_version: data.semantic_version,
    input_refs: inputRefs,
    snapshot_refs: data.snapshot_refs,
    source_refs: data.source_refs,
    limitations: unique(report.limitations),
    draft_id: input.previous_draft.payload.draft_id,
    revision: 2,
    data_analysis_pack_artifact_id: resolved.data_analysis_pack.artifact_id,
    comparison_pack_artifact_id: resolved.comparison_pack.artifact_id,
    chart_pack_artifact_id: resolved.chart_pack.artifact_id,
    analysis_pack_artifact_id: resolved.analysis_pack.artifact_id,
    insight_pack_artifact_id: resolved.insight_pack.artifact_id,
    ...(resolved.decision_intelligence_pack
      ? { decision_intelligence_artifact_id: resolved.decision_intelligence_pack.artifact_id }
      : {}),
    report,
    evidence_refs: uniqueEvidence([
      ...expectedDraft(resolved).evidence_refs,
      ...review.issues.flatMap((issue) => issue.evidence_refs),
    ]),
  });
}

/** Builds the single immutable revision permitted after a blocking review. */
export function buildReportDraftRevision(input: ReportRevisionAgentInput): ReportDraft {
  return expectedRevisionDraft(input);
}

export function validateReportDraftRevision(
  draft: ReportDraft,
  input: ReportRevisionAgentInput,
): void {
  const parsed = ReportDraftSchema.parse(draft);
  if (canonical(parsed) !== canonical(expectedRevisionDraft(input)))
    throw new ReportAgentError('REPORT_AGENT_OUTPUT_INVALID');
}

/** Compatibility oracle only. It is deliberately not a publication or reviewer PASS. */
export function validateDraftReportCompatibility(
  draft: ReportDraft,
  artifacts: Artifact[],
  orgId: string,
  runId: string,
): void {
  validateReport(draft.report, artifacts, orgId, runId);
}

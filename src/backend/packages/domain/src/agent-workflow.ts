import {
  ReportDraftSchema,
  ReviewResultSchema,
  type AnalysisRun,
  type Artifact,
  type ArtifactOf,
  type CanonicalEvidenceRef,
  type ReviewResult,
  type WorkflowPackMetadata,
} from '@vda/contracts';
import { buildDecisionBrief } from '@vda/semantic';
import { canonical, readArtifactPath, stableId, validateReport, verifyArtifact } from './integrity';
import { reportSections } from './report-sections';

export class AgentWorkflowValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * A reviewer may request this one bounded remediation. Revision two preserves
 * the canonical report projection and records the existing evidence binding;
 * it never authorizes new prose, metrics, chart values, or claims.
 */
export const EVIDENCE_BOUND_REVISION_MESSAGE =
  'This evidence-bound claim requires an immutable review revision before publication.';
export const EVIDENCE_BOUND_REVISION_CORRECTION =
  'Create revision two that preserves this deterministic claim exactly, records this existing evidence binding, and reruns review. No metric, chart, or claim text may be rewritten.';

const sameIds = (actual: readonly string[], expected: readonly string[]) =>
  canonical([...actual].sort()) === canonical([...expected].sort());

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueEvidence(values: readonly CanonicalEvidenceRef[]): CanonicalEvidenceRef[] {
  const byKey = new Map(
    values.map((value) => [`${value.artifact_id}:${value.artifact_key}:${value.path}`, value]),
  );
  return [...byKey.values()].sort((left, right) =>
    `${left.artifact_id}:${left.artifact_key}:${left.path}`.localeCompare(
      `${right.artifact_id}:${right.artifact_key}:${right.path}`,
    ),
  );
}

function artifactMap(artifacts: readonly Artifact[]): Map<string, Artifact> {
  const byId = new Map(artifacts.map((artifact) => [artifact.artifact_id, artifact]));
  if (byId.size !== artifacts.length) throw new AgentWorkflowValidationError('DUPLICATE_ARTIFACT');
  for (const artifact of artifacts) verifyArtifact(artifact);
  return byId;
}

function inputClosure(root: Artifact, byId: Map<string, Artifact>): Set<string> {
  const reachable = new Set<string>();
  const visit = (artifact: Artifact, seen = new Set<string>()) => {
    if (seen.has(artifact.artifact_id)) throw new AgentWorkflowValidationError('LINEAGE_CYCLE');
    for (const inputId of artifact.input_refs) {
      const input = byId.get(inputId);
      if (!input) throw new AgentWorkflowValidationError('BROKEN_LINEAGE');
      reachable.add(inputId);
      visit(input, new Set([...seen, artifact.artifact_id]));
    }
  };
  visit(root);
  return reachable;
}

function validateEvidenceRefs(
  refs: readonly CanonicalEvidenceRef[],
  root: Artifact,
  byId: Map<string, Artifact>,
  artifactKeys?: ReadonlyMap<string, string>,
): void {
  const reachable = inputClosure(root, byId);
  for (const ref of refs) {
    const artifact = byId.get(ref.artifact_id);
    if (!artifact || !reachable.has(ref.artifact_id))
      throw new AgentWorkflowValidationError('INVALID_EVIDENCE_LINEAGE');
    if (
      expectedArtifactKey(artifact) !== ref.artifact_key ||
      (artifactKeys !== undefined && artifactKeys.get(artifact.artifact_id) !== ref.artifact_key)
    )
      throw new AgentWorkflowValidationError('INVALID_EVIDENCE_KEY');
    try {
      readArtifactPath(artifact, ref.path);
    } catch {
      throw new AgentWorkflowValidationError('INVALID_EVIDENCE_PATH');
    }
  }
}

function sameMetadata(
  artifact: Artifact,
  metadata: WorkflowPackMetadata,
  run: AnalysisRun,
): boolean {
  return (
    artifact.org_id === run.org_id &&
    artifact.run_id === run.run_id &&
    artifact.data_as_of === run.request.data_as_of &&
    metadata.org_id === run.org_id &&
    metadata.run_id === run.run_id &&
    metadata.data_as_of === run.request.data_as_of &&
    metadata.use_case === run.request.use_case &&
    canonical(metadata.scope) === canonical(run.request.scope) &&
    metadata.semantic_version === artifact.semantic_version &&
    sameIds(metadata.input_refs, artifact.input_refs) &&
    sameIds(metadata.snapshot_refs, artifact.snapshot_refs) &&
    sameIds(metadata.source_refs, artifact.source_refs)
  );
}

function requiredArtifact<K extends Artifact['kind']>(
  byId: Map<string, Artifact>,
  id: string,
  kind: K,
): Extract<Artifact, { kind: K }> {
  const artifact = byId.get(id);
  if (artifact?.kind !== kind) throw new AgentWorkflowValidationError('INVALID_REQUIRED_ARTIFACT');
  return artifact as Extract<Artifact, { kind: K }>;
}

function singleInputOfKind<K extends Artifact['kind']>(
  artifact: Artifact,
  byId: Map<string, Artifact>,
  kind: K,
): Extract<Artifact, { kind: K }> {
  const matches = artifact.input_refs
    .map((id) => byId.get(id))
    .filter((candidate): candidate is Extract<Artifact, { kind: K }> => candidate?.kind === kind);
  if (matches.length !== 1) throw new AgentWorkflowValidationError('INVALID_PACK_INPUT');
  return matches[0];
}

function expectedArtifactKey(artifact: Artifact): string | null {
  switch (artifact.kind) {
    case 'analysis_request':
    case 'coordinator_decision':
    case 'data_analysis_pack':
    case 'comparison_pack':
    case 'chart_pack':
    case 'analysis_pack':
    case 'insight':
    case 'insight_pack':
    case 'report':
      return artifact.kind;
    case 'query':
      return 'data.query';
    case 'query_result':
      return 'data.query_result';
    case 'calculation':
      return 'data.calculation';
    case 'comparison_calculation':
      return 'data.comparison_calculation';
    case 'comparison':
      return 'data.comparison';
    case 'visual_evidence':
      return 'chart.visual_evidence';
    case 'report_draft':
      return `report_draft:${artifact.payload.revision}`;
    case 'review_result':
      return `review_result:${artifact.payload.draft_revision}`;
    default:
      return null;
  }
}

function expectedTaskKind(artifact: Artifact): string | null {
  switch (artifact.kind) {
    case 'analysis_request':
    case 'coordinator_decision':
      return 'coordinator';
    case 'query':
    case 'query_result':
    case 'calculation':
    case 'comparison_calculation':
    case 'comparison':
    case 'data_analysis_pack':
      return 'data';
    case 'comparison_pack':
      return 'comparison';
    case 'chart_pack':
    case 'visual_evidence':
      return 'chart';
    case 'analysis_pack':
      return 'analyst';
    case 'insight':
    case 'insight_pack':
      return 'insight';
    case 'report_draft':
      return 'report';
    case 'review_result':
      return 'reviewer';
    case 'report':
      return 'publication';
    default:
      return null;
  }
}

function validatePersistedKeys(
  artifacts: readonly Artifact[],
  run: AnalysisRun,
  artifactKeys?: ReadonlyMap<string, string>,
): void {
  for (const artifact of artifacts) {
    const expected = expectedArtifactKey(artifact);
    const taskKind = expectedTaskKind(artifact);
    if (
      expected === null ||
      taskKind === null ||
      artifact.artifact_id !== stableId(`${run.run_id}:artifact:${expected}`) ||
      artifact.task_id !== stableId(`${run.run_id}:task:${taskKind}`) ||
      artifact.created_at !== run.created_at ||
      artifact.org_id !== run.org_id ||
      artifact.run_id !== run.run_id ||
      artifact.data_as_of !== run.request.data_as_of ||
      (artifact.kind === 'report_draft' &&
        artifact.payload.revision !== 1 &&
        artifact.payload.revision !== 2) ||
      (artifact.kind === 'review_result' &&
        artifact.payload.draft_revision !== 1 &&
        artifact.payload.draft_revision !== 2) ||
      (artifactKeys !== undefined && artifactKeys.get(artifact.artifact_id) !== expected)
    )
      throw new AgentWorkflowValidationError('INVALID_ARTIFACT_KEY_BINDING');
  }
}

/** Reconstructs the established report serializer from persisted canonical inputs. */
function expectedReportProjection(
  draft: ArtifactOf<'report_draft'>,
  byId: Map<string, Artifact>,
  run: AnalysisRun,
) {
  const data = requiredArtifact(
    byId,
    draft.payload.data_analysis_pack_artifact_id,
    'data_analysis_pack',
  );
  const calculation = requiredArtifact(
    byId,
    data.payload.dataset.calculation_artifact_id,
    'calculation',
  );
  const comparison = requiredArtifact(
    byId,
    data.payload.dataset.comparison_artifact_id,
    'comparison',
  );
  const chartPack = requiredArtifact(byId, draft.payload.chart_pack_artifact_id, 'chart_pack');
  const visualEvidence = singleInputOfKind(chartPack, byId, 'visual_evidence');
  const insightPack = requiredArtifact(
    byId,
    draft.payload.insight_pack_artifact_id,
    'insight_pack',
  );
  const insight = singleInputOfKind(insightPack, byId, 'insight');
  return {
    title: `Inventory report \u00c2\u00b7 ${run.request.scope.zone_external_id ?? run.request.scope.project_external_id}`,
    summary: insight.payload.summary,
    claims: insight.payload.claims,
    metrics: calculation.payload.metrics,
    units: calculation.payload.units,
    calculation_artifact_id: calculation.artifact_id,
    chart_artifact_id: visualEvidence.artifact_id,
    comparison_artifact_id: comparison.artifact_id,
    sections: reportSections(calculation, visualEvidence, comparison, insight),
    limitations: [...calculation.limitations, ...calculation.payload.quality_limitations],
    decision_brief: buildDecisionBrief(
      calculation.payload,
      calculation.artifact_id,
      run.request.scope,
      run.request.data_as_of,
    ),
  };
}

function expectedDraftEvidenceRefs(
  draft: ArtifactOf<'report_draft'>,
  byId: Map<string, Artifact>,
): CanonicalEvidenceRef[] {
  const data = requiredArtifact(
    byId,
    draft.payload.data_analysis_pack_artifact_id,
    'data_analysis_pack',
  );
  const calculation = requiredArtifact(
    byId,
    data.payload.dataset.calculation_artifact_id,
    'calculation',
  );
  const comparison = requiredArtifact(
    byId,
    data.payload.dataset.comparison_artifact_id,
    'comparison',
  );
  const comparisonPack = requiredArtifact(
    byId,
    draft.payload.comparison_pack_artifact_id,
    'comparison_pack',
  );
  const chartPack = requiredArtifact(byId, draft.payload.chart_pack_artifact_id, 'chart_pack');
  const visualEvidence = singleInputOfKind(chartPack, byId, 'visual_evidence');
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
  const insight = singleInputOfKind(insightPack, byId, 'insight');
  const base: CanonicalEvidenceRef[] = [
    { artifact_id: data.artifact_id, artifact_key: 'data_analysis_pack', path: 'payload.metrics' },
    {
      artifact_id: comparisonPack.artifact_id,
      artifact_key: 'comparison_pack',
      path: 'payload.comparisons',
    },
    { artifact_id: chartPack.artifact_id, artifact_key: 'chart_pack', path: 'payload.charts' },
    {
      artifact_id: analysisPack.artifact_id,
      artifact_key: 'analysis_pack',
      path: 'payload.findings',
    },
    { artifact_id: insightPack.artifact_id, artifact_key: 'insight_pack', path: 'payload.claims' },
    {
      artifact_id: calculation.artifact_id,
      artifact_key: 'data.calculation',
      path: 'payload.metrics',
    },
    { artifact_id: comparison.artifact_id, artifact_key: 'data.comparison', path: 'payload.items' },
    {
      artifact_id: visualEvidence.artifact_id,
      artifact_key: 'chart.visual_evidence',
      path: 'payload.charts',
    },
    { artifact_id: insight.artifact_id, artifact_key: 'insight', path: 'payload.claims' },
  ];
  if (draft.payload.revision === 1) return base;
  const review = draft.input_refs
    .map((id) => byId.get(id))
    .find(
      (artifact): artifact is ArtifactOf<'review_result'> => artifact?.kind === 'review_result',
    );
  if (!review) throw new AgentWorkflowValidationError('INVALID_DRAFT_REVISION_INPUT');
  return uniqueEvidence([
    ...base,
    ...review.payload.issues.flatMap((issue) => issue.evidence_refs),
  ]);
}

function validatePackReferences(
  draft: ArtifactOf<'report_draft'>,
  byId: Map<string, Artifact>,
  artifacts: readonly Artifact[],
  run: AnalysisRun,
  artifactKeys?: ReadonlyMap<string, string>,
): void {
  const payload = draft.payload;
  const data = requiredArtifact(byId, payload.data_analysis_pack_artifact_id, 'data_analysis_pack');
  const comparisonPack = requiredArtifact(
    byId,
    payload.comparison_pack_artifact_id,
    'comparison_pack',
  );
  const chartPack = requiredArtifact(byId, payload.chart_pack_artifact_id, 'chart_pack');
  const analysisPack = requiredArtifact(byId, payload.analysis_pack_artifact_id, 'analysis_pack');
  const insightPack = requiredArtifact(byId, payload.insight_pack_artifact_id, 'insight_pack');
  const packs: Array<{ artifact: Artifact; metadata: WorkflowPackMetadata }> = [
    { artifact: data, metadata: data.payload },
    { artifact: comparisonPack, metadata: comparisonPack.payload },
    { artifact: chartPack, metadata: chartPack.payload },
    { artifact: analysisPack, metadata: analysisPack.payload },
    { artifact: insightPack, metadata: insightPack.payload },
  ];
  if (
    !packs.every(
      ({ artifact, metadata }) =>
        sameMetadata(artifact, metadata, run) &&
        metadata.use_case_version === data.payload.use_case_version,
    ) ||
    payload.use_case_version !== data.payload.use_case_version ||
    canonical(payload.snapshot_refs) !== canonical(data.payload.snapshot_refs) ||
    canonical(payload.source_refs) !== canonical(data.payload.source_refs)
  )
    throw new AgentWorkflowValidationError('INVALID_PACK_METADATA');
  const expectedIds = packs.map(({ artifact }) => artifact.artifact_id);
  if (expectedIds.some((id) => !draft.input_refs.includes(id)))
    throw new AgentWorkflowValidationError('INVALID_DRAFT_PACK_INPUT');
  const reviewInputs = draft.input_refs.filter((id) => !expectedIds.includes(id));
  if (
    (payload.revision === 1 && !sameIds(draft.input_refs, expectedIds)) ||
    (payload.revision === 2 &&
      (reviewInputs.length !== 1 || !sameIds(draft.input_refs, [...expectedIds, reviewInputs[0]])))
  )
    throw new AgentWorkflowValidationError('INVALID_DRAFT_INPUTS');
  if (payload.revision === 2) {
    const review = requiredArtifact(byId, reviewInputs[0], 'review_result');
    const prior = byId.get(review.payload.draft_artifact_id);
    if (
      review.payload.status !== 'REVISION_REQUIRED' ||
      prior?.kind !== 'report_draft' ||
      review.payload.draft_id !== draft.payload.draft_id ||
      review.payload.draft_revision !== 1 ||
      prior.payload.draft_id !== draft.payload.draft_id ||
      prior.payload.revision !== 1 ||
      review.payload.draft_content_hash !== prior.content_hash ||
      !sameIds(review.input_refs, [prior.artifact_id])
    )
      throw new AgentWorkflowValidationError('INVALID_DRAFT_REVISION_INPUT');
    // A revision is only valid when its predecessor is a complete, typed
    // review artifact. This deliberately rechecks review evidence rather
    // than treating an ID-shaped link as authorization to revise.
    validateReviewResultArtifact(
      review as ArtifactOf<'review_result'>,
      prior as ArtifactOf<'report_draft'>,
      artifacts,
      run,
      artifactKeys,
    );
  }
}

/** Validates the durable Report Agent output independently of the agent process. */
export function validateReportDraftArtifact(
  draft: ArtifactOf<'report_draft'>,
  artifacts: readonly Artifact[],
  run: AnalysisRun,
  artifactKeys?: ReadonlyMap<string, string>,
): void {
  verifyArtifact(draft);
  const payload = ReportDraftSchema.parse(draft.payload);
  const byId = artifactMap(artifacts);
  validatePersistedKeys(artifacts, run, artifactKeys);
  if (!byId.has(draft.artifact_id) || !sameMetadata(draft, payload, run))
    throw new AgentWorkflowValidationError('INVALID_DRAFT_METADATA');
  if (
    payload.draft_id !== stableId(`${run.run_id}:report-draft`) ||
    payload.pack_id !== stableId(`${run.run_id}:report-draft:${payload.revision}`) ||
    payload.report.decision_brief === undefined
  )
    throw new AgentWorkflowValidationError('INVALID_DRAFT_IDENTITY');
  validatePackReferences(draft, byId, artifacts, run, artifactKeys);
  const expectedProjection = expectedReportProjection(draft, byId, run);
  if (
    canonical(payload.evidence_refs) !== canonical(expectedDraftEvidenceRefs(draft, byId)) ||
    canonical(payload.limitations) !== canonical(uniqueStrings(expectedProjection.limitations)) ||
    canonical(draft.limitations) !== canonical(payload.limitations)
  )
    throw new AgentWorkflowValidationError('REPORT_AGENT_PROJECTION_CHANGED');
  validateEvidenceRefs(payload.evidence_refs, draft, byId, artifactKeys);
  try {
    validateReport(payload.report, [...artifacts], run.org_id, run.run_id);
  } catch (error) {
    if (error instanceof Error && /^[A-Z_]{1,80}$/.test(error.message))
      throw new AgentWorkflowValidationError(error.message);
    throw error;
  }
  if (canonical(payload.report) !== canonical(expectedProjection))
    throw new AgentWorkflowValidationError('REPORT_AGENT_PROJECTION_CHANGED');
}

/** Validates structured reviewer output without granting it publication authority. */
export function validateReviewResultArtifact(
  review: ArtifactOf<'review_result'>,
  draft: ArtifactOf<'report_draft'>,
  artifacts: readonly Artifact[],
  run: AnalysisRun,
  artifactKeys?: ReadonlyMap<string, string>,
): void {
  verifyArtifact(review);
  const payload = ReviewResultSchema.parse(review.payload);
  const byId = artifactMap(artifacts);
  validatePersistedKeys(artifacts, run, artifactKeys);
  if (
    !byId.has(review.artifact_id) ||
    !byId.has(draft.artifact_id) ||
    !sameMetadata(review, payload, run)
  )
    throw new AgentWorkflowValidationError('INVALID_REVIEW_METADATA');
  // The reviewer is never trusted as a substitute for the Report Agent. This
  // independent revalidation is also used by the fenced publication gate.
  validateReportDraftArtifact(draft, artifacts, run, artifactKeys);
  if (
    payload.pack_id !== stableId(`${run.run_id}:review-result:${payload.draft_revision}`) ||
    payload.review_id !== stableId(`${run.run_id}:review:${payload.draft_revision}`) ||
    payload.draft_artifact_id !== draft.artifact_id ||
    payload.draft_id !== draft.payload.draft_id ||
    payload.draft_revision !== draft.payload.revision ||
    payload.draft_content_hash !== draft.content_hash ||
    !sameIds(review.input_refs, [draft.artifact_id]) ||
    payload.use_case_version !== draft.payload.use_case_version ||
    canonical(payload.snapshot_refs) !== canonical(draft.snapshot_refs) ||
    canonical(payload.source_refs) !== canonical(draft.source_refs) ||
    canonical(payload.limitations) !== canonical(draft.payload.limitations) ||
    canonical(review.limitations) !== canonical(payload.limitations)
  )
    throw new AgentWorkflowValidationError('INVALID_REVIEW_DRAFT_BINDING');
  const expectedSummary =
    payload.status === 'PASS'
      ? `Draft revision ${payload.draft_revision} passed deterministic evidence, metric, chart, scope, and limitation checks.`
      : `Draft revision ${payload.draft_revision} requires the listed corrections before publication.`;
  if (
    payload.provider !== 'deterministic' ||
    payload.summary !== expectedSummary ||
    (payload.status === 'PASS' && payload.issues.length !== 0)
  )
    throw new AgentWorkflowValidationError('INVALID_DETERMINISTIC_REVIEW');
  if (payload.status === 'REVISION_REQUIRED') {
    const issue = payload.issues[0];
    const claim =
      issue?.claim_id === null || issue?.claim_id === undefined
        ? undefined
        : draft.payload.report.claims.find((candidate) => candidate.claim_id === issue.claim_id);
    const expectedIssue =
      issue && claim
        ? {
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
          }
        : undefined;
    if (
      payload.issues.length !== 1 ||
      !expectedIssue ||
      canonical(payload.issues) !== canonical([expectedIssue])
    )
      throw new AgentWorkflowValidationError('INVALID_DETERMINISTIC_REVIEW');
  }
  validateEvidenceRefs(
    payload.issues.flatMap((issue) => issue.evidence_refs),
    review,
    byId,
    artifactKeys,
  );
}

/**
 * Atomic publication uses this gate after re-reading the graph under a fence.
 * A valid schema alone never turns a review into PASS.
 */
export function validateAgentPublication(
  draft: ArtifactOf<'report_draft'>,
  review: ArtifactOf<'review_result'>,
  report: ArtifactOf<'report'>,
  persistedArtifacts: readonly Artifact[],
  run: AnalysisRun,
  artifactKeys?: ReadonlyMap<string, string>,
): void {
  if (run.workflow_version !== 'agent-v1')
    throw new AgentWorkflowValidationError('AGENT_PUBLICATION_NOT_SELECTED');
  const graph = [...persistedArtifacts, report];
  const graphKeys = artifactKeys
    ? new Map([...artifactKeys, [report.artifact_id, 'report']])
    : undefined;
  validateReportDraftArtifact(draft, persistedArtifacts, run, artifactKeys);
  validateReviewResultArtifact(review, draft, persistedArtifacts, run, artifactKeys);
  if (review.payload.status !== 'PASS')
    throw new AgentWorkflowValidationError('REVIEW_PASS_REQUIRED');
  verifyArtifact(report);
  validatePersistedKeys(graph, run, graphKeys);
  if (
    report.artifact_id !== stableId(`${run.run_id}:artifact:report`) ||
    report.task_id !== stableId(`${run.run_id}:task:publication`) ||
    report.created_at !== run.created_at ||
    report.org_id !== run.org_id ||
    report.run_id !== run.run_id ||
    report.data_as_of !== run.request.data_as_of ||
    report.semantic_version !== draft.semantic_version ||
    canonical(report.payload) !== canonical(draft.payload.report) ||
    !sameIds(report.snapshot_refs, draft.snapshot_refs) ||
    !sameIds(report.source_refs, draft.source_refs) ||
    !sameIds(report.limitations, draft.payload.report.limitations)
  )
    throw new AgentWorkflowValidationError('INVALID_PUBLICATION_REPORT');
  const byId = artifactMap(persistedArtifacts);
  const insightPack = requiredArtifact(
    byId,
    draft.payload.insight_pack_artifact_id,
    'insight_pack',
  );
  const insight = singleInputOfKind(insightPack, byId, 'insight');
  const expectedInputs = [
    draft.payload.report.calculation_artifact_id,
    draft.payload.report.chart_artifact_id,
    draft.payload.report.comparison_artifact_id,
    insight?.artifact_id ?? '',
  ];
  if (!sameIds(report.input_refs, expectedInputs))
    throw new AgentWorkflowValidationError('INVALID_PUBLICATION_LINEAGE');
  validateReport(report.payload, graph, run.org_id, run.run_id);
}

export type DraftReviewBinding = {
  draft: ArtifactOf<'report_draft'>;
  review: ArtifactOf<'review_result'>;
  artifacts: Artifact[];
  run: AnalysisRun;
};

export function reviewResultForDraft(
  review: ReviewResult,
  draft: ArtifactOf<'report_draft'>,
): boolean {
  return (
    review.draft_artifact_id === draft.artifact_id &&
    review.draft_id === draft.payload.draft_id &&
    review.draft_revision === draft.payload.revision &&
    review.draft_content_hash === draft.content_hash
  );
}

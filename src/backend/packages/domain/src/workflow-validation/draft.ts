import { ReportDraftSchema, type WorkflowPackMetadata } from '@vda/contracts/agents/workflow-packs';
import type { AnalysisRun } from '@vda/contracts/analysis/run';
import type { Artifact, ArtifactOf } from '@vda/contracts/artifacts/artifact';
import type { CanonicalEvidenceRef } from '@vda/contracts/decision/intelligence';
import { buildDecisionBrief } from '@vda/semantic/decisions/build-decision-brief';
import { canonical, stableId, verifyArtifact } from '../artifacts/integrity';
import { validateReport } from '../reports/report-validation';
import { reportSections } from '../reports/report-sections';
import {
  AgentWorkflowValidationError,
  sameIds,
  uniqueStrings,
  uniqueEvidence,
  artifactMap,
  validateEvidenceRefs,
  sameMetadata,
  requiredArtifact,
  singleInputOfKind,
  validatePersistedKeys,
} from './artifact-graph';
import { validateReviewResultArtifactCore } from './review';

/** Reconstructs the established report serializer from persisted canonical inputs. */
export function expectedReportProjection(
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
  const decisionPack = draft.payload.decision_intelligence_artifact_id
    ? requiredArtifact(
        byId,
        draft.payload.decision_intelligence_artifact_id,
        'decision_intelligence_pack',
      )
    : null;
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
    ...(decisionPack ? { decision_intelligence_artifact_id: decisionPack.artifact_id } : {}),
  };
}

export function expectedDraftEvidenceRefs(
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
  const decisionPack = draft.payload.decision_intelligence_artifact_id
    ? requiredArtifact(
        byId,
        draft.payload.decision_intelligence_artifact_id,
        'decision_intelligence_pack',
      )
    : null;
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
    ...(decisionPack
      ? [
          {
            artifact_id: decisionPack.artifact_id,
            artifact_key: 'decision_intelligence_pack',
            path: 'payload.decision_brief',
          },
        ]
      : []),
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

export function validatePackReferences(
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
  const decisionPack = payload.decision_intelligence_artifact_id
    ? requiredArtifact(
        byId,
        payload.decision_intelligence_artifact_id,
        'decision_intelligence_pack',
      )
    : null;
  const packs: Array<{ artifact: Artifact; metadata: WorkflowPackMetadata }> = [
    { artifact: data, metadata: data.payload },
    { artifact: comparisonPack, metadata: comparisonPack.payload },
    { artifact: chartPack, metadata: chartPack.payload },
    { artifact: analysisPack, metadata: analysisPack.payload },
    { artifact: insightPack, metadata: insightPack.payload },
    ...(decisionPack ? [{ artifact: decisionPack, metadata: decisionPack.payload }] : []),
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
    payload.report.decision_brief === undefined ||
    (payload.decision_intelligence_artifact_id !== undefined &&
      payload.report.decision_intelligence_artifact_id !==
        payload.decision_intelligence_artifact_id)
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

export function validateReviewResultArtifact(
  review: ArtifactOf<'review_result'>,
  draft: ArtifactOf<'report_draft'>,
  artifacts: readonly Artifact[],
  run: AnalysisRun,
  artifactKeys?: ReadonlyMap<string, string>,
): void {
  validateReviewResultArtifactCore(
    review,
    draft,
    artifacts,
    run,
    validateReportDraftArtifact,
    artifactKeys,
  );
}

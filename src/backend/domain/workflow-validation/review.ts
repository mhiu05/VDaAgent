import { ReviewResultSchema, type ReviewResult } from '@vda/contracts/agents/workflow-packs';
import type { AnalysisRun } from '@vda/contracts/analysis/run';
import type { Artifact, ArtifactOf } from '@vda/contracts/artifacts/artifact';
import { canonical, stableId, verifyArtifact } from '../artifacts/integrity';
import {
  AgentWorkflowValidationError,
  EVIDENCE_BOUND_REVISION_MESSAGE,
  EVIDENCE_BOUND_REVISION_CORRECTION,
  sameIds,
  artifactMap,
  validateEvidenceRefs,
  sameMetadata,
  validatePersistedKeys,
} from './artifact-graph';

/** Validates structured reviewer output without granting it publication authority. */
export function validateReviewResultArtifactCore(
  review: ArtifactOf<'review_result'>,
  draft: ArtifactOf<'report_draft'>,
  artifacts: readonly Artifact[],
  run: AnalysisRun,
  validateDraft: (
    draft: ArtifactOf<'report_draft'>,
    artifacts: readonly Artifact[],
    run: AnalysisRun,
    artifactKeys?: ReadonlyMap<string, string>,
  ) => void,
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
  validateDraft(draft, artifacts, run, artifactKeys);
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

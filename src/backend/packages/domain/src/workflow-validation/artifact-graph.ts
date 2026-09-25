import type { AnalysisRun } from '@vda/contracts/analysis/run';
import type { Artifact } from '@vda/contracts/artifacts/artifact';
import type { CanonicalEvidenceRef } from '@vda/contracts/decision/intelligence';
import type { WorkflowPackMetadata } from '@vda/contracts/agents/workflow-packs';
import { canonical, readArtifactPath, stableId, verifyArtifact } from '../artifacts/integrity';

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

export const sameIds = (actual: readonly string[], expected: readonly string[]) =>
  canonical([...actual].sort()) === canonical([...expected].sort());

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function uniqueEvidence(values: readonly CanonicalEvidenceRef[]): CanonicalEvidenceRef[] {
  const byKey = new Map(
    values.map((value) => [`${value.artifact_id}:${value.artifact_key}:${value.path}`, value]),
  );
  return [...byKey.values()].sort((left, right) =>
    `${left.artifact_id}:${left.artifact_key}:${left.path}`.localeCompare(
      `${right.artifact_id}:${right.artifact_key}:${right.path}`,
    ),
  );
}

export function artifactMap(artifacts: readonly Artifact[]): Map<string, Artifact> {
  const byId = new Map(artifacts.map((artifact) => [artifact.artifact_id, artifact]));
  if (byId.size !== artifacts.length) throw new AgentWorkflowValidationError('DUPLICATE_ARTIFACT');
  for (const artifact of artifacts) verifyArtifact(artifact);
  return byId;
}

export function inputClosure(root: Artifact, byId: Map<string, Artifact>): Set<string> {
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

export function validateEvidenceRefs(
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

export function sameMetadata(
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

export function requiredArtifact<K extends Artifact['kind']>(
  byId: Map<string, Artifact>,
  id: string,
  kind: K,
): Extract<Artifact, { kind: K }> {
  const artifact = byId.get(id);
  if (artifact?.kind !== kind) throw new AgentWorkflowValidationError('INVALID_REQUIRED_ARTIFACT');
  return artifact as Extract<Artifact, { kind: K }>;
}

export function singleInputOfKind<K extends Artifact['kind']>(
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

export function expectedArtifactKey(artifact: Artifact): string | null {
  switch (artifact.kind) {
    case 'analysis_request':
    case 'coordinator_decision':
    case 'data_analysis_pack':
    case 'comparison_pack':
    case 'chart_pack':
    case 'analysis_pack':
    case 'insight':
    case 'insight_pack':
    case 'decision_intelligence_pack':
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

export function expectedTaskKind(artifact: Artifact): string | null {
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
    case 'decision_intelligence_pack':
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

export function validatePersistedKeys(
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

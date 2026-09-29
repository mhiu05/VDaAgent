import {
  ComparisonPackSchema,
  type ArtifactOf,
  type CanonicalEvidenceRef,
  type ComparisonPack,
  type DataAnalysisPack,
} from '@vda/contracts';
import { canonical, stableId, verifyArtifact } from '@vda/domain';

export class ComparisonAgentError extends Error {
  constructor(readonly code: 'COMPARISON_AGENT_INPUT_INVALID' | 'COMPARISON_AGENT_OUTPUT_INVALID') {
    super(code);
  }
}

export type ComparisonAgentInput = {
  data_analysis_pack: ArtifactOf<'data_analysis_pack'>;
  data_analysis_pack_key?: string;
};

function dataFrom(input: ComparisonAgentInput): {
  artifact: ArtifactOf<'data_analysis_pack'>;
  pack: DataAnalysisPack;
  key: string;
} {
  const artifact = input.data_analysis_pack;
  verifyArtifact(artifact);
  const pack = artifact.payload;
  if (
    artifact.org_id !== pack.org_id ||
    artifact.run_id !== pack.run_id ||
    artifact.data_as_of !== pack.data_as_of ||
    artifact.semantic_version !== pack.semantic_version
  )
    throw new ComparisonAgentError('COMPARISON_AGENT_INPUT_INVALID');
  return { artifact, pack, key: input.data_analysis_pack_key ?? 'data_analysis_pack' };
}

function evidence(artifactId: string, artifactKey: string): CanonicalEvidenceRef[] {
  return [
    { artifact_id: artifactId, artifact_key: artifactKey, path: 'payload.peer_items' },
    { artifact_id: artifactId, artifact_key: artifactKey, path: 'payload.period_comparisons' },
    { artifact_id: artifactId, artifact_key: artifactKey, path: 'payload.segment_comparisons' },
    { artifact_id: artifactId, artifact_key: artifactKey, path: 'payload.notable_changes' },
  ];
}

function expectedPack(input: ComparisonAgentInput): ComparisonPack {
  const { artifact, pack, key } = dataFrom(input);
  return ComparisonPackSchema.parse({
    contract_version: 'comparison-pack-v1',
    pack_id: stableId(`${pack.run_id}:comparison-pack`),
    run_id: pack.run_id,
    org_id: pack.org_id,
    use_case: pack.use_case,
    use_case_version: pack.use_case_version,
    scope: pack.scope,
    data_as_of: pack.data_as_of,
    semantic_version: pack.semantic_version,
    input_refs: [artifact.artifact_id],
    snapshot_refs: pack.snapshot_refs,
    source_refs: pack.source_refs,
    limitations: pack.limitations,
    data_analysis_pack_artifact_id: artifact.artifact_id,
    comparisons: pack.peer_items,
    period_comparisons: pack.period_comparisons,
    segment_comparisons: pack.segment_comparisons,
    notable_changes: pack.notable_changes,
    evidence_refs: evidence(artifact.artifact_id, key),
  });
}

/**
 * Projects only Data-owned, precomputed comparison values into a typed branch
 * pack. It intentionally has no SQL, model, or arithmetic dependency.
 */
export function buildComparisonPack(input: ComparisonAgentInput): ComparisonPack {
  return expectedPack(input);
}

export function validateComparisonPack(pack: ComparisonPack, input: ComparisonAgentInput): void {
  const parsed = ComparisonPackSchema.parse(pack);
  const expected = expectedPack(input);
  if (canonical(parsed) !== canonical(expected))
    throw new ComparisonAgentError('COMPARISON_AGENT_OUTPUT_INVALID');
}

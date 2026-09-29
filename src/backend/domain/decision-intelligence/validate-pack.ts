import {
  DecisionIntelligencePackSchema,
  type DecisionIntelligencePack,
} from '@vda/contracts/agents/workflow-packs';
import type { Artifact } from '@vda/contracts/artifacts/artifact';
import { canonical, readArtifactPath } from '../artifacts/integrity';
import {
  buildDecisionIntelligencePack,
  DecisionIntelligenceError,
  resolved,
  type DecisionIntelligenceInput,
} from './build-pack';

/** Rebuilds from canonical inputs so a pack cannot change ranking, values, policy, or lineage. */
export function validateDecisionIntelligencePack(
  pack: DecisionIntelligencePack,
  input: DecisionIntelligenceInput,
): void {
  const parsed = DecisionIntelligencePackSchema.parse(pack);
  const source = resolved(input);
  const expected = buildDecisionIntelligencePack(source);
  if (canonical(parsed) !== canonical(expected))
    throw new DecisionIntelligenceError('DECISION_PACK_INVALID');
  const artifacts = new Map<string, Artifact>([
    [source.data_analysis_pack.artifact_id, source.data_analysis_pack],
    [source.calculation.artifact_id, source.calculation],
    [source.comparison.artifact_id, source.comparison],
    [source.comparison_pack.artifact_id, source.comparison_pack],
    [source.visual_evidence.artifact_id, source.visual_evidence],
    [source.chart_pack.artifact_id, source.chart_pack],
    [source.analysis_pack.artifact_id, source.analysis_pack],
    [source.insight_pack.artifact_id, source.insight_pack],
  ]);
  for (const ref of parsed.evidence_refs) {
    const artifact = artifacts.get(ref.artifact_id);
    if (!artifact || artifact.org_id !== parsed.org_id || artifact.run_id !== parsed.run_id)
      throw new DecisionIntelligenceError('CROSS_RUN_DECISION_REFERENCE');
    readArtifactPath(artifact, ref.path);
  }
}

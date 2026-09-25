import type { ArtifactOf } from '@vda/contracts/artifacts/artifact';
import type { Claim } from '@vda/contracts/analysis/chart';
import { canonical, readArtifactPath } from '../artifacts/integrity';

export function bindClaims(calculation: ArtifactOf<'calculation'>): Claim[] {
  const candidateIds = calculation.payload.insight_candidates.map(
    (candidate) => candidate.candidate_id,
  );
  if (new Set(candidateIds).size !== candidateIds.length) throw new Error('DUPLICATE_CLAIM');
  return calculation.payload.insight_candidates.map((candidate) => {
    const index = calculation.payload.metrics.findIndex(
      (metric) => metric.key === candidate.metric_key,
    );
    if (index < 0) throw new Error('INVALID_INSIGHT_CANDIDATE');
    const metric = calculation.payload.metrics[index];
    if (candidate.evidence_paths.length !== 1) throw new Error('INVALID_INSIGHT_EVIDENCE');
    const evidencePath = candidate.evidence_paths[0];
    const metricMatch = evidencePath.match(/^payload\.metrics\[(\d+)\]\.value$/);
    const comparisonMatch = evidencePath.match(
      /^payload\.period_comparisons\[(\d+)\]\.current_value$/,
    );
    const evidenceMetricKey = metricMatch
      ? calculation.payload.metrics[Number(metricMatch[1])]?.key
      : comparisonMatch
        ? calculation.payload.period_comparisons[Number(comparisonMatch[1])]?.metric_key
        : null;
    if (evidenceMetricKey !== candidate.metric_key) throw new Error('INVALID_INSIGHT_EVIDENCE');
    const evidenceValue = readArtifactPath(calculation, evidencePath);
    if (canonical(evidenceValue) !== canonical(metric.value))
      throw new Error('INVALID_INSIGHT_EVIDENCE');
    return {
      claim_id: `${calculation.artifact_id}:${candidate.candidate_id}`,
      text: `${candidate.observation} ${candidate.interpretation}`,
      metric_key: metric.key,
      value: metric.value,
      evidence_artifact_id: calculation.artifact_id,
      evidence_path: evidencePath,
    };
  });
}

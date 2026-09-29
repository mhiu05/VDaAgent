import {
  AnalysisPackSchema,
  type AnalysisFinding,
  type AnalysisPack,
  type ArtifactOf,
  type CanonicalEvidenceRef,
  type DataAnalysisPack,
} from '@vda/contracts';
import { readArtifactPath } from '@vda/domain';
import { canonical, stableId, verifyArtifact } from '@vda/domain';

export class AnalystAgentError extends Error {
  constructor(readonly code: 'ANALYST_AGENT_INPUT_INVALID' | 'ANALYST_AGENT_OUTPUT_INVALID') {
    super(code);
  }
}

export type AnalystAgentInput = {
  data_analysis_pack: ArtifactOf<'data_analysis_pack'>;
  data_analysis_pack_key?: string;
};

function resolveInput(input: AnalystAgentInput): {
  artifact: ArtifactOf<'data_analysis_pack'>;
  data: DataAnalysisPack;
  key: string;
} {
  const artifact = input.data_analysis_pack;
  verifyArtifact(artifact);
  const data = artifact.payload;
  if (
    artifact.org_id !== data.org_id ||
    artifact.run_id !== data.run_id ||
    artifact.data_as_of !== data.data_as_of ||
    artifact.semantic_version !== data.semantic_version
  )
    throw new AnalystAgentError('ANALYST_AGENT_INPUT_INVALID');
  return { artifact, data, key: input.data_analysis_pack_key ?? 'data_analysis_pack' };
}

function category(candidateId: string, metricKey: string): AnalysisFinding['category'] {
  if (candidateId.startsWith('notable:')) return 'trend';
  if (metricKey.startsWith('missing_')) return 'data_quality';
  return 'current_state';
}

function findings(
  artifact: ArtifactOf<'data_analysis_pack'>,
  data: DataAnalysisPack,
  key: string,
): AnalysisFinding[] {
  return data.insight_candidates.map((candidate) => {
    const refs: CanonicalEvidenceRef[] = candidate.evidence_paths.map((path) => {
      try {
        readArtifactPath(artifact, path);
      } catch {
        throw new AnalystAgentError('ANALYST_AGENT_INPUT_INVALID');
      }
      return { artifact_id: artifact.artifact_id, artifact_key: key, path };
    });
    if (!refs.length) throw new AnalystAgentError('ANALYST_AGENT_INPUT_INVALID');
    return {
      finding_id: `finding:${candidate.candidate_id}`,
      candidate_id: candidate.candidate_id,
      category: category(candidate.candidate_id, candidate.metric_key),
      kind: 'descriptive',
      // This is existing deterministic candidate language; the Analyst does
      // not create causal explanations or numeric values.
      statement: candidate.observation,
      metric_key: candidate.metric_key,
      support_level: candidate.limitations.length ? 'limited' : 'high',
      evidence_refs: refs,
      limitations: candidate.limitations,
    };
  });
}

function expectedPack(input: AnalystAgentInput): AnalysisPack {
  const { artifact, data, key } = resolveInput(input);
  const output = findings(artifact, data, key);
  const evidenceRefs = output.length
    ? output.flatMap((finding) => finding.evidence_refs)
    : [
        {
          artifact_id: artifact.artifact_id,
          artifact_key: key,
          path: 'payload.insight_candidates',
        },
      ];
  return AnalysisPackSchema.parse({
    contract_version: 'analysis-pack-v1',
    pack_id: stableId(`${data.run_id}:analysis-pack`),
    run_id: data.run_id,
    org_id: data.org_id,
    use_case: data.use_case,
    use_case_version: data.use_case_version,
    scope: data.scope,
    data_as_of: data.data_as_of,
    semantic_version: data.semantic_version,
    input_refs: [artifact.artifact_id],
    snapshot_refs: data.snapshot_refs,
    source_refs: data.source_refs,
    limitations: data.limitations,
    data_analysis_pack_artifact_id: artifact.artifact_id,
    findings: output,
    evidence_refs: evidenceRefs,
  });
}

/** Emits bounded, descriptive findings from deterministic Data candidates only. */
export function buildAnalysisPack(input: AnalystAgentInput): AnalysisPack {
  return expectedPack(input);
}

export function validateAnalysisPack(pack: AnalysisPack, input: AnalystAgentInput): void {
  const parsed = AnalysisPackSchema.parse(pack);
  if (canonical(parsed) !== canonical(expectedPack(input)))
    throw new AnalystAgentError('ANALYST_AGENT_OUTPUT_INVALID');
}

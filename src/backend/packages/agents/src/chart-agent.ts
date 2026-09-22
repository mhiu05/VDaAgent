import {
  ChartPackSchema,
  type Artifact,
  type ArtifactOf,
  type CanonicalEvidenceRef,
  type ChartPack,
  type DataAnalysisPack,
  type VisualEvidencePayload,
} from '@vda/contracts';
import { readArtifactPath } from '@vda/domain';
import { canonical, stableId, verifyArtifact } from './integrity';
import { ChartBuilder, validateVisualEvidence } from './chart-builder';

export class ChartAgentError extends Error {
  constructor(readonly code: 'CHART_AGENT_INPUT_INVALID' | 'CHART_AGENT_OUTPUT_INVALID') {
    super(code);
  }
}

export type ChartAgentInput = {
  data_analysis_pack: ArtifactOf<'data_analysis_pack'>;
  calculation: ArtifactOf<'calculation'>;
  comparison: ArtifactOf<'comparison'>;
  keys?: {
    data_analysis_pack?: string;
    calculation?: string;
    comparison?: string;
    visual_evidence?: string;
  };
};

export type ChartPackInput = ChartAgentInput & {
  visual_evidence: ArtifactOf<'visual_evidence'>;
};

type ResolvedChartInput = {
  dataArtifact: ArtifactOf<'data_analysis_pack'>;
  data: DataAnalysisPack;
  calculation: ArtifactOf<'calculation'>;
  comparison: ArtifactOf<'comparison'>;
  keys: Required<NonNullable<ChartAgentInput['keys']>>;
};

function resolveInput(input: ChartAgentInput): ResolvedChartInput {
  const dataArtifact = input.data_analysis_pack;
  const { calculation, comparison } = input;
  verifyArtifact(dataArtifact);
  verifyArtifact(calculation);
  verifyArtifact(comparison);
  const data = dataArtifact.payload;
  const keys = {
    data_analysis_pack: input.keys?.data_analysis_pack ?? 'data_analysis_pack',
    calculation: input.keys?.calculation ?? 'data.calculation',
    comparison: input.keys?.comparison ?? 'data.comparison',
    visual_evidence: input.keys?.visual_evidence ?? 'chart.visual_evidence',
  };
  if (
    dataArtifact.org_id !== data.org_id ||
    dataArtifact.run_id !== data.run_id ||
    dataArtifact.data_as_of !== data.data_as_of ||
    dataArtifact.semantic_version !== data.semantic_version ||
    calculation.org_id !== data.org_id ||
    calculation.run_id !== data.run_id ||
    comparison.org_id !== data.org_id ||
    comparison.run_id !== data.run_id ||
    calculation.data_as_of !== data.data_as_of ||
    comparison.data_as_of !== data.data_as_of ||
    calculation.semantic_version !== data.semantic_version ||
    comparison.semantic_version !== data.semantic_version ||
    data.dataset.calculation_artifact_id !== calculation.artifact_id ||
    data.dataset.comparison_artifact_id !== comparison.artifact_id ||
    !data.input_refs.includes(calculation.artifact_id) ||
    !data.input_refs.includes(comparison.artifact_id) ||
    canonical(data.metrics) !== canonical(calculation.payload.metrics) ||
    canonical(data.age_buckets) !== canonical(calculation.payload.age_buckets) ||
    canonical(data.breakdowns) !== canonical(calculation.payload.breakdowns) ||
    canonical(data.period_comparisons) !== canonical(calculation.payload.period_comparisons) ||
    canonical(data.segment_comparisons) !== canonical(calculation.payload.segment_comparisons) ||
    canonical(data.peer_items) !== canonical(comparison.payload.items) ||
    canonical(data.period_comparisons) !== canonical(comparison.payload.period_comparisons) ||
    canonical(data.segment_comparisons) !== canonical(comparison.payload.segment_comparisons)
  )
    throw new ChartAgentError('CHART_AGENT_INPUT_INVALID');
  return { dataArtifact, data, calculation, comparison, keys };
}

/** Builds chart values exclusively with the established deterministic renderer. */
export function buildChartEvidence(input: ChartAgentInput): VisualEvidencePayload {
  const { calculation, comparison } = resolveInput(input);
  const payload = new ChartBuilder().build({ calculation, comparison });
  validateVisualEvidence(payload, [calculation, comparison]);
  return payload;
}

function assertVisualEvidence(input: ChartPackInput, resolved: ResolvedChartInput): void {
  const visual = input.visual_evidence;
  verifyArtifact(visual);
  if (
    visual.org_id !== resolved.data.org_id ||
    visual.run_id !== resolved.data.run_id ||
    visual.data_as_of !== resolved.data.data_as_of ||
    visual.semantic_version !== resolved.data.semantic_version ||
    !visual.input_refs.includes(resolved.calculation.artifact_id) ||
    !visual.input_refs.includes(resolved.comparison.artifact_id) ||
    canonical(visual.payload) !== canonical(buildChartEvidence(input))
  )
    throw new ChartAgentError('CHART_AGENT_INPUT_INVALID');
  validateVisualEvidence(visual.payload, [resolved.calculation, resolved.comparison]);
}

function chartEvidenceRefs(resolved: ResolvedChartInput): CanonicalEvidenceRef[] {
  const refs: CanonicalEvidenceRef[] = [
    {
      artifact_id: resolved.dataArtifact.artifact_id,
      artifact_key: resolved.keys.data_analysis_pack,
      path: 'payload',
    },
  ];
  const artifactKey = (artifactId: string) => {
    if (artifactId === resolved.calculation.artifact_id) return resolved.keys.calculation;
    if (artifactId === resolved.comparison.artifact_id) return resolved.keys.comparison;
    throw new ChartAgentError('CHART_AGENT_OUTPUT_INVALID');
  };
  const source = new Map<string, Artifact>([
    [resolved.calculation.artifact_id, resolved.calculation],
    [resolved.comparison.artifact_id, resolved.comparison],
  ]);
  for (const chart of new ChartBuilder().build({
    calculation: resolved.calculation,
    comparison: resolved.comparison,
  }).charts) {
    for (const binding of chart.provenance.bindings) {
      const artifact = source.get(binding.artifact_id);
      if (!artifact) throw new ChartAgentError('CHART_AGENT_OUTPUT_INVALID');
      try {
        readArtifactPath(artifact, binding.evidence_path);
      } catch {
        throw new ChartAgentError('CHART_AGENT_OUTPUT_INVALID');
      }
      refs.push({
        artifact_id: binding.artifact_id,
        artifact_key: artifactKey(binding.artifact_id),
        path: binding.evidence_path,
      });
    }
  }
  return refs;
}

function expectedPack(input: ChartPackInput): ChartPack {
  const resolved = resolveInput(input);
  assertVisualEvidence(input, resolved);
  const visual = input.visual_evidence;
  return ChartPackSchema.parse({
    contract_version: 'chart-pack-v1',
    pack_id: stableId(`${resolved.data.run_id}:chart-pack`),
    run_id: resolved.data.run_id,
    org_id: resolved.data.org_id,
    use_case: resolved.data.use_case,
    use_case_version: resolved.data.use_case_version,
    scope: resolved.data.scope,
    data_as_of: resolved.data.data_as_of,
    semantic_version: resolved.data.semantic_version,
    input_refs: [resolved.dataArtifact.artifact_id, visual.artifact_id].sort(),
    snapshot_refs: resolved.data.snapshot_refs,
    source_refs: resolved.data.source_refs,
    limitations: resolved.data.limitations,
    data_analysis_pack_artifact_id: resolved.dataArtifact.artifact_id,
    charts: visual.payload.charts,
    unavailable: visual.payload.unavailable,
    evidence_refs: chartEvidenceRefs(resolved),
  });
}

export function buildChartPack(input: ChartPackInput): ChartPack {
  return expectedPack(input);
}

export function validateChartPack(pack: ChartPack, input: ChartPackInput): void {
  const parsed = ChartPackSchema.parse(pack);
  if (canonical(parsed) !== canonical(expectedPack(input)))
    throw new ChartAgentError('CHART_AGENT_OUTPUT_INVALID');
}

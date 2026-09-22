import {
  InsightPackSchema,
  type Artifact,
  type ArtifactOf,
  type CanonicalEvidenceRef,
  type Claim,
  type DataAnalysisPack,
  type InsightPack,
  type WorkflowPackMetadata,
} from '@vda/contracts';
import { readArtifactPath } from '@vda/domain';
import { validateAnalysisPack } from './analyst-agent';
import { validateChartPack } from './chart-agent';
import { validateComparisonPack } from './comparison-agent';
import { bindClaims, canonical, SAFE_SUMMARY, stableId, verifyArtifact } from './integrity';

export class InsightAgentError extends Error {
  constructor(
    readonly code:
      | 'INSIGHT_AGENT_INPUT_INVALID'
      | 'INSIGHT_AGENT_NARRATIVE_INVALID'
      | 'INSIGHT_AGENT_OUTPUT_INVALID',
  ) {
    super(code);
  }
}

/** The existing provider is constrained to these exact, evidence-bound values. */
export type InsightNarrative = {
  summary: string;
  claims: Claim[];
  provider: 'gemini' | 'openai';
};

export type InsightSourceInput = {
  data_analysis_pack: ArtifactOf<'data_analysis_pack'>;
  calculation: ArtifactOf<'calculation'>;
  comparison: ArtifactOf<'comparison'>;
  comparison_pack: ArtifactOf<'comparison_pack'>;
  visual_evidence: ArtifactOf<'visual_evidence'>;
  chart_pack: ArtifactOf<'chart_pack'>;
  analysis_pack: ArtifactOf<'analysis_pack'>;
  keys?: {
    data_analysis_pack?: string;
    calculation?: string;
    comparison?: string;
    comparison_pack?: string;
    visual_evidence?: string;
    chart_pack?: string;
    analysis_pack?: string;
    insight?: string;
  };
};

export type InsightAgentInput = InsightSourceInput & {
  insight: ArtifactOf<'insight'>;
};

type ResolvedInsightInput = {
  dataArtifact: ArtifactOf<'data_analysis_pack'>;
  data: DataAnalysisPack;
  calculation: ArtifactOf<'calculation'>;
  comparison: ArtifactOf<'comparison'>;
  comparisonPack: ArtifactOf<'comparison_pack'>;
  visualEvidence: ArtifactOf<'visual_evidence'>;
  chartPack: ArtifactOf<'chart_pack'>;
  analysisPack: ArtifactOf<'analysis_pack'>;
  keys: Required<NonNullable<InsightSourceInput['keys']>>;
};

function metadataMatches(
  artifact: Artifact,
  metadata: WorkflowPackMetadata,
  data: DataAnalysisPack,
): boolean {
  return (
    artifact.org_id === data.org_id &&
    artifact.run_id === data.run_id &&
    artifact.data_as_of === data.data_as_of &&
    artifact.semantic_version === data.semantic_version &&
    metadata.org_id === data.org_id &&
    metadata.run_id === data.run_id &&
    metadata.use_case === data.use_case &&
    metadata.use_case_version === data.use_case_version &&
    metadata.data_as_of === data.data_as_of &&
    metadata.semantic_version === data.semantic_version &&
    canonical(metadata.scope) === canonical(data.scope) &&
    canonical(metadata.snapshot_refs) === canonical(data.snapshot_refs) &&
    canonical(metadata.source_refs) === canonical(data.source_refs)
  );
}

function resolveInput(input: InsightSourceInput): ResolvedInsightInput {
  const dataArtifact = input.data_analysis_pack;
  const {
    calculation,
    comparison,
    comparison_pack: comparisonPack,
    visual_evidence: visualEvidence,
    chart_pack: chartPack,
    analysis_pack: analysisPack,
  } = input;
  for (const artifact of [
    dataArtifact,
    calculation,
    comparison,
    comparisonPack,
    visualEvidence,
    chartPack,
    analysisPack,
  ])
    verifyArtifact(artifact);
  const data = dataArtifact.payload;
  const keys = {
    data_analysis_pack: input.keys?.data_analysis_pack ?? 'data_analysis_pack',
    calculation: input.keys?.calculation ?? 'data.calculation',
    comparison: input.keys?.comparison ?? 'data.comparison',
    comparison_pack: input.keys?.comparison_pack ?? 'comparison_pack',
    visual_evidence: input.keys?.visual_evidence ?? 'chart.visual_evidence',
    chart_pack: input.keys?.chart_pack ?? 'chart_pack',
    analysis_pack: input.keys?.analysis_pack ?? 'analysis_pack',
    insight: input.keys?.insight ?? 'insight',
  };
  if (
    !metadataMatches(dataArtifact, data, data) ||
    calculation.org_id !== data.org_id ||
    calculation.run_id !== data.run_id ||
    calculation.data_as_of !== data.data_as_of ||
    calculation.semantic_version !== data.semantic_version ||
    comparison.org_id !== data.org_id ||
    comparison.run_id !== data.run_id ||
    comparison.data_as_of !== data.data_as_of ||
    comparison.semantic_version !== data.semantic_version ||
    data.dataset.calculation_artifact_id !== calculation.artifact_id ||
    data.dataset.comparison_artifact_id !== comparison.artifact_id ||
    canonical(data.insight_candidates) !== canonical(calculation.payload.insight_candidates) ||
    !metadataMatches(comparisonPack, comparisonPack.payload, data) ||
    !metadataMatches(chartPack, chartPack.payload, data) ||
    !metadataMatches(analysisPack, analysisPack.payload, data)
  )
    throw new InsightAgentError('INSIGHT_AGENT_INPUT_INVALID');
  try {
    validateComparisonPack(comparisonPack.payload, {
      data_analysis_pack: dataArtifact,
      data_analysis_pack_key: keys.data_analysis_pack,
    });
    validateChartPack(chartPack.payload, {
      data_analysis_pack: dataArtifact,
      calculation,
      comparison,
      visual_evidence: visualEvidence,
      keys,
    });
    validateAnalysisPack(analysisPack.payload, {
      data_analysis_pack: dataArtifact,
      data_analysis_pack_key: keys.data_analysis_pack,
    });
  } catch {
    throw new InsightAgentError('INSIGHT_AGENT_INPUT_INVALID');
  }
  return {
    dataArtifact,
    data,
    calculation,
    comparison,
    comparisonPack,
    visualEvidence,
    chartPack,
    analysisPack,
    keys,
  };
}

function assertNarrative(
  calculation: ArtifactOf<'calculation'>,
  narrative: InsightNarrative,
): Claim[] {
  const expected = bindClaims(calculation);
  if (narrative.summary !== SAFE_SUMMARY || !['gemini', 'openai'].includes(narrative.provider))
    throw new InsightAgentError('INSIGHT_AGENT_NARRATIVE_INVALID');
  const actualById = new Map(narrative.claims.map((claim) => [claim.claim_id, claim]));
  if (actualById.size !== expected.length || narrative.claims.length !== expected.length)
    throw new InsightAgentError('INSIGHT_AGENT_NARRATIVE_INVALID');
  for (const claim of expected) {
    if (canonical(actualById.get(claim.claim_id)) !== canonical(claim))
      throw new InsightAgentError('INSIGHT_AGENT_NARRATIVE_INVALID');
  }
  // Canonical ordering makes a retry stable even when a provider orders IDs differently.
  return expected;
}

export function buildLegacyInsightPayload(
  input: InsightSourceInput,
  narrative: InsightNarrative,
): ArtifactOf<'insight'>['payload'] {
  const resolved = resolveInput(input);
  const claims = assertNarrative(resolved.calculation, narrative);
  return {
    summary: SAFE_SUMMARY,
    claims,
    candidate_ids: resolved.data.insight_candidates.map((candidate) => candidate.candidate_id),
    provider: narrative.provider,
  };
}

function assertLegacyInsight(input: InsightAgentInput, resolved: ResolvedInsightInput): void {
  const insight = input.insight;
  verifyArtifact(insight);
  if (
    insight.org_id !== resolved.data.org_id ||
    insight.run_id !== resolved.data.run_id ||
    insight.data_as_of !== resolved.data.data_as_of ||
    insight.semantic_version !== resolved.data.semantic_version ||
    !insight.input_refs.includes(resolved.calculation.artifact_id) ||
    !insight.input_refs.includes(resolved.comparison.artifact_id)
  )
    throw new InsightAgentError('INSIGHT_AGENT_INPUT_INVALID');
  const expected = buildLegacyInsightPayload(input, insight.payload);
  if (canonical(insight.payload) !== canonical(expected))
    throw new InsightAgentError('INSIGHT_AGENT_INPUT_INVALID');
}

function evidence(artifact: Artifact, artifactKey: string, path: string): CanonicalEvidenceRef {
  try {
    readArtifactPath(artifact, path);
  } catch {
    throw new InsightAgentError('INSIGHT_AGENT_OUTPUT_INVALID');
  }
  return { artifact_id: artifact.artifact_id, artifact_key: artifactKey, path };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function expectedPack(input: InsightAgentInput): InsightPack {
  const resolved = resolveInput(input);
  assertLegacyInsight(input, resolved);
  const claims = bindClaims(resolved.calculation);
  const findings = resolved.analysisPack.payload.findings;
  if (
    findings.length !== claims.length ||
    new Set(findings.map((finding) => finding.candidate_id)).size !== claims.length ||
    claims.some((claim) => {
      const candidateId = claim.claim_id.slice(`${resolved.calculation.artifact_id}:`.length);
      return !findings.some((finding) => finding.candidate_id === candidateId);
    })
  )
    throw new InsightAgentError('INSIGHT_AGENT_INPUT_INVALID');
  const evidenceRefs = [
    evidence(resolved.dataArtifact, resolved.keys.data_analysis_pack, 'payload.insight_candidates'),
    evidence(resolved.comparisonPack, resolved.keys.comparison_pack, 'payload.notable_changes'),
    evidence(resolved.chartPack, resolved.keys.chart_pack, 'payload.charts'),
    evidence(resolved.analysisPack, resolved.keys.analysis_pack, 'payload.findings'),
    ...claims.map((claim) =>
      evidence(resolved.calculation, resolved.keys.calculation, claim.evidence_path),
    ),
  ];
  return InsightPackSchema.parse({
    contract_version: 'insight-pack-v1',
    pack_id: stableId(`${resolved.data.run_id}:insight-pack`),
    run_id: resolved.data.run_id,
    org_id: resolved.data.org_id,
    use_case: resolved.data.use_case,
    use_case_version: resolved.data.use_case_version,
    scope: resolved.data.scope,
    data_as_of: resolved.data.data_as_of,
    semantic_version: resolved.data.semantic_version,
    input_refs: [
      resolved.dataArtifact.artifact_id,
      resolved.comparisonPack.artifact_id,
      resolved.chartPack.artifact_id,
      resolved.analysisPack.artifact_id,
      input.insight.artifact_id,
    ].sort(),
    snapshot_refs: resolved.data.snapshot_refs,
    source_refs: resolved.data.source_refs,
    limitations: unique([
      ...resolved.data.limitations,
      ...findings.flatMap((finding) => finding.limitations),
    ]),
    data_analysis_pack_artifact_id: resolved.dataArtifact.artifact_id,
    comparison_pack_artifact_id: resolved.comparisonPack.artifact_id,
    chart_pack_artifact_id: resolved.chartPack.artifact_id,
    analysis_pack_artifact_id: resolved.analysisPack.artifact_id,
    summary: SAFE_SUMMARY,
    claims,
    selected_finding_ids: findings.map((finding) => finding.finding_id),
    evidence_refs: evidenceRefs,
    provider: input.insight.payload.provider,
  });
}

/**
 * Joins the Data and all three persisted branch packs. It only accepts the
 * existing bounded provider result; facts and claim values stay canonical.
 */
export function buildInsightPack(input: InsightAgentInput): InsightPack {
  return expectedPack(input);
}

export function validateInsightPack(pack: InsightPack, input: InsightAgentInput): void {
  const parsed = InsightPackSchema.parse(pack);
  if (canonical(parsed) !== canonical(expectedPack(input)))
    throw new InsightAgentError('INSIGHT_AGENT_OUTPUT_INVALID');
}

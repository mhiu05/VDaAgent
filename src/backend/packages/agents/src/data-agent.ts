import {
  DataAnalysisPackSchema,
  SEMANTIC_VERSION,
  type AnalysisRun,
  type Artifact,
  type ArtifactOf,
  type CanonicalEvidenceRef,
  type ComparisonItem,
  type DataAnalysisPack,
  type UnitSnapshot,
} from '@vda/contracts';
import { canonical, readArtifactPath, stableId, verifyArtifact } from '@vda/domain';
import { analyze, compare, selectLatest, semanticPack } from '@vda/semantic';
import { getUseCaseDefinition } from './use-cases';

export class DataAgentError extends Error {
  constructor(
    readonly code:
      | 'DATA_AGENT_SCOPE_MISMATCH'
      | 'DATA_AGENT_DATE_MISMATCH'
      | 'DATA_AGENT_LINEAGE_MISMATCH'
      | 'DATA_AGENT_NUMERIC_MISMATCH'
      | 'DATA_AGENT_VERSION_MISMATCH',
  ) {
    super(code);
  }
}

export type DataArtifactKeys = {
  query: string;
  query_result: string;
  calculation: string;
  comparison_calculation: string;
  comparison: string;
};

export type DataAgentArtifacts = {
  query: ArtifactOf<'query'>;
  query_result: ArtifactOf<'query_result'>;
  calculation: ArtifactOf<'calculation'>;
  comparison_calculation: ArtifactOf<'comparison_calculation'>;
  comparison: ArtifactOf<'comparison'>;
};

export type DataAnalysisPackInput = DataAgentArtifacts & {
  run: AnalysisRun;
  pack_id?: string;
  artifact_keys?: Partial<DataArtifactKeys>;
};

export type DeterministicDataOutput = {
  calculation: ArtifactOf<'calculation'>['payload'];
  peer_items: ComparisonItem[];
};

const sameIds = (actual: readonly string[], expected: readonly string[]) =>
  canonical([...new Set(actual)].sort()) === canonical([...new Set(expected)].sort());

const defaultKeys: DataArtifactKeys = {
  query: 'query',
  query_result: 'query_result',
  calculation: 'calculation',
  comparison_calculation: 'comparison_calculation',
  comparison: 'comparison',
};

/**
 * The only numeric calculation entrypoint for the agent workflow. It uses the
 * established semantic package verbatim and never accepts model-supplied SQL
 * or numeric values.
 */
export function calculateDataAgentOutput(
  run: AnalysisRun,
  rows: UnitSnapshot[],
  slowMovingThresholdDays: number,
): DeterministicDataOutput {
  const calculation = analyze(
    rows,
    run.org_id,
    run.request.scope,
    run.request.data_as_of,
    slowMovingThresholdDays,
  );
  const peerItems = compare(
    selectLatest(rows, run.org_id, run.request.data_as_of, run.request.scope),
  );
  return { calculation, peer_items: peerItems };
}

function assertArtifactCompatibility(input: DataAnalysisPackInput): void {
  const artifacts = [
    input.query,
    input.query_result,
    input.calculation,
    input.comparison_calculation,
    input.comparison,
  ];
  for (const artifact of artifacts) {
    verifyArtifact(artifact);
    if (artifact.org_id !== input.run.org_id || artifact.run_id !== input.run.run_id)
      throw new DataAgentError('DATA_AGENT_SCOPE_MISMATCH');
    if (artifact.data_as_of !== input.run.request.data_as_of)
      throw new DataAgentError('DATA_AGENT_DATE_MISMATCH');
    if (artifact.semantic_version !== SEMANTIC_VERSION)
      throw new DataAgentError('DATA_AGENT_VERSION_MISMATCH');
  }
  const rows = input.query_result.payload.rows;
  if (
    input.query_result.payload.row_count !== rows.length ||
    rows.some(
      (row) =>
        row.org_id !== input.run.org_id ||
        row.project_external_id !== input.run.request.scope.project_external_id,
    )
  )
    throw new DataAgentError('DATA_AGENT_SCOPE_MISMATCH');
  if (
    !sameIds(
      input.query_result.snapshot_refs,
      rows.map((row) => row.snapshot_id),
    ) ||
    !sameIds(
      input.query_result.source_refs,
      rows.map((row) => row.import_id),
    ) ||
    !input.query_result.input_refs.includes(input.query.artifact_id) ||
    !input.calculation.input_refs.includes(input.query_result.artifact_id) ||
    !input.comparison_calculation.input_refs.includes(input.query_result.artifact_id) ||
    !input.comparison_calculation.input_refs.includes(input.calculation.artifact_id) ||
    !input.comparison.input_refs.includes(input.comparison_calculation.artifact_id) ||
    input.comparison.payload.calculation_artifact_id !== input.comparison_calculation.artifact_id
  )
    throw new DataAgentError('DATA_AGENT_LINEAGE_MISMATCH');

  const expected = calculateDataAgentOutput(
    input.run,
    rows,
    input.calculation.payload.slow_moving_threshold_days,
  );
  if (
    canonical(expected.calculation) !== canonical(input.calculation.payload) ||
    canonical(expected.peer_items) !== canonical(input.comparison_calculation.payload.items) ||
    canonical(input.comparison.payload.items) !==
      canonical(input.comparison_calculation.payload.items) ||
    canonical(input.comparison.payload.period_comparisons) !==
      canonical(input.calculation.payload.period_comparisons) ||
    canonical(input.comparison.payload.segment_comparisons) !==
      canonical(input.calculation.payload.segment_comparisons) ||
    input.comparison_calculation.payload.rounding !== 'decimal-half-up-6dp' ||
    input.comparison_calculation.payload.rule !== semanticPack.peer_rule
  )
    throw new DataAgentError('DATA_AGENT_NUMERIC_MISMATCH');
}

function evidenceRefs(
  calculation: ArtifactOf<'calculation'>,
  comparisonCalculation: ArtifactOf<'comparison_calculation'>,
  comparison: ArtifactOf<'comparison'>,
  keys: DataArtifactKeys,
): CanonicalEvidenceRef[] {
  return [
    {
      artifact_id: calculation.artifact_id,
      artifact_key: keys.calculation,
      path: 'payload',
    },
    {
      artifact_id: comparisonCalculation.artifact_id,
      artifact_key: keys.comparison_calculation,
      path: 'payload.items',
    },
    {
      artifact_id: comparison.artifact_id,
      artifact_key: keys.comparison,
      path: 'payload.items',
    },
    ...calculation.payload.metrics.map((_, index) => ({
      artifact_id: calculation.artifact_id,
      artifact_key: keys.calculation,
      path: `payload.metrics[${index}].value`,
    })),
  ];
}

/**
 * Builds the bounded canonical pack from immutable, persisted Data-owned
 * artifacts. It does not query the warehouse or accept free-form SQL.
 */
export function buildDataAnalysisPack(input: DataAnalysisPackInput): DataAnalysisPack {
  assertArtifactCompatibility(input);
  const definition = getUseCaseDefinition(input.run.request.use_case);
  const keys = { ...defaultKeys, ...input.artifact_keys };
  const {
    calculation,
    comparison_calculation: comparisonCalculation,
    comparison,
    query,
    query_result: queryResult,
  } = input;
  const refs = evidenceRefs(calculation, comparisonCalculation, comparison, keys);
  const pack = DataAnalysisPackSchema.parse({
    contract_version: 'data-analysis-pack-v1',
    pack_id: input.pack_id ?? stableId(`${input.run.run_id}:data-analysis-pack`),
    run_id: input.run.run_id,
    org_id: input.run.org_id,
    use_case: definition.key,
    use_case_version: definition.version,
    scope: input.run.request.scope,
    data_as_of: input.run.request.data_as_of,
    semantic_version: SEMANTIC_VERSION,
    input_refs: [
      query.artifact_id,
      queryResult.artifact_id,
      calculation.artifact_id,
      comparisonCalculation.artifact_id,
      comparison.artifact_id,
    ].sort(),
    snapshot_refs: queryResult.snapshot_refs,
    source_refs: queryResult.source_refs,
    limitations: [
      ...new Set([definition.provisional_limitation, ...calculation.payload.quality_limitations]),
    ],
    metric_config: {
      slow_moving_threshold_days: calculation.payload.slow_moving_threshold_days,
    },
    dataset: {
      row_count: queryResult.payload.row_count,
      query_artifact_id: query.artifact_id,
      query_result_artifact_id: queryResult.artifact_id,
      calculation_artifact_id: calculation.artifact_id,
      comparison_calculation_artifact_id: comparisonCalculation.artifact_id,
      comparison_artifact_id: comparison.artifact_id,
    },
    metrics: calculation.payload.metrics,
    units: calculation.payload.units,
    age_buckets: calculation.payload.age_buckets,
    breakdowns: calculation.payload.breakdowns,
    period_comparisons: calculation.payload.period_comparisons,
    segment_comparisons: calculation.payload.segment_comparisons,
    notable_changes: calculation.payload.notable_changes,
    peer_items: comparisonCalculation.payload.items,
    insight_candidates: calculation.payload.insight_candidates,
    quality_limitations: calculation.payload.quality_limitations,
    evidence_refs: refs,
  });
  validateDataAnalysisPack(pack, input);
  return pack;
}

/** Validates that the pack is an exact, evidence-bound projection of Data artifacts. */
export function validateDataAnalysisPack(
  pack: DataAnalysisPack,
  input: DataAnalysisPackInput,
): void {
  const parsed = DataAnalysisPackSchema.parse(pack);
  assertArtifactCompatibility(input);
  const definition = getUseCaseDefinition(input.run.request.use_case);
  const {
    calculation,
    comparison_calculation: comparisonCalculation,
    comparison,
    query,
    query_result: queryResult,
  } = input;
  if (
    parsed.run_id !== input.run.run_id ||
    parsed.org_id !== input.run.org_id ||
    parsed.use_case !== definition.key ||
    parsed.use_case_version !== definition.version ||
    canonical(parsed.scope) !== canonical(input.run.request.scope) ||
    parsed.data_as_of !== input.run.request.data_as_of ||
    parsed.semantic_version !== SEMANTIC_VERSION ||
    !sameIds(parsed.input_refs, [
      query.artifact_id,
      queryResult.artifact_id,
      calculation.artifact_id,
      comparisonCalculation.artifact_id,
      comparison.artifact_id,
    ]) ||
    !sameIds(parsed.snapshot_refs, queryResult.snapshot_refs) ||
    !sameIds(parsed.source_refs, queryResult.source_refs) ||
    parsed.dataset.row_count !== queryResult.payload.row_count ||
    parsed.dataset.query_artifact_id !== query.artifact_id ||
    parsed.dataset.query_result_artifact_id !== queryResult.artifact_id ||
    parsed.dataset.calculation_artifact_id !== calculation.artifact_id ||
    parsed.dataset.comparison_calculation_artifact_id !== comparisonCalculation.artifact_id ||
    parsed.dataset.comparison_artifact_id !== comparison.artifact_id ||
    parsed.metric_config.slow_moving_threshold_days !==
      calculation.payload.slow_moving_threshold_days ||
    canonical(parsed.metrics) !== canonical(calculation.payload.metrics) ||
    canonical(parsed.units) !== canonical(calculation.payload.units) ||
    canonical(parsed.age_buckets) !== canonical(calculation.payload.age_buckets) ||
    canonical(parsed.breakdowns) !== canonical(calculation.payload.breakdowns) ||
    canonical(parsed.period_comparisons) !== canonical(calculation.payload.period_comparisons) ||
    canonical(parsed.segment_comparisons) !== canonical(calculation.payload.segment_comparisons) ||
    canonical(parsed.notable_changes) !== canonical(calculation.payload.notable_changes) ||
    canonical(parsed.peer_items) !== canonical(comparisonCalculation.payload.items) ||
    canonical(parsed.insight_candidates) !== canonical(calculation.payload.insight_candidates) ||
    canonical(parsed.quality_limitations) !== canonical(calculation.payload.quality_limitations)
  )
    throw new DataAgentError('DATA_AGENT_LINEAGE_MISMATCH');

  const sources = new Map<string, Artifact>([
    [calculation.artifact_id, calculation],
    [comparisonCalculation.artifact_id, comparisonCalculation],
    [comparison.artifact_id, comparison],
  ]);
  for (const ref of parsed.evidence_refs) {
    const source = sources.get(ref.artifact_id);
    if (!source) throw new DataAgentError('DATA_AGENT_LINEAGE_MISMATCH');
    try {
      readArtifactPath(source, ref.path);
    } catch {
      throw new DataAgentError('DATA_AGENT_LINEAGE_MISMATCH');
    }
  }
}

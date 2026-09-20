import { createHash } from 'node:crypto';
import {
  ArtifactSchema,
  MetricKeySchema,
  ReportPayloadSchema,
  type Artifact,
  type ArtifactOf,
  type Claim,
  type ReportPayload,
} from '@vda/contracts';

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(',')}}`;
}
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function artifactHash(artifact: Omit<Artifact, 'content_hash'> | Artifact): string {
  const { content_hash: _hash, ...body } = artifact as Artifact;
  return contentHash(body);
}
export function stableId(value: string): string {
  const hex = contentHash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function verifyArtifact(artifact: Artifact): void {
  ArtifactSchema.parse(artifact);
  if (artifactHash(artifact) !== artifact.content_hash) throw new Error('ARTIFACT_HASH_MISMATCH');
}

export function readArtifactPath(value: unknown, path: string): unknown {
  const tokens = [...path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((match) =>
    match[2] === undefined ? match[1] : Number(match[2]),
  );
  let current: unknown = value;
  for (const token of tokens) {
    if (typeof token === 'number') {
      if (!Array.isArray(current) || token >= current.length)
        throw new Error('INVALID_EVIDENCE_PATH');
      current = current[token];
    } else {
      if (!token || current === null || typeof current !== 'object' || !(token in current))
        throw new Error('INVALID_EVIDENCE_PATH');
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current;
}
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
export const SAFE_SUMMARY =
  'Kết quả mô tả tồn kho trong phạm vi và ngày dữ liệu đã chọn. Cần kiểm tra bằng chứng và giới hạn dữ liệu trước khi ra quyết định.';
export function validateReport(
  report: ReportPayload,
  artifacts: Artifact[],
  orgId: string,
  runId: string,
): void {
  ReportPayloadSchema.parse(report);
  const byId = new Map(artifacts.map((a) => [a.artifact_id, a]));
  if (byId.size !== artifacts.length) throw new Error('DUPLICATE_ARTIFACT');
  const sameIds = (actual: string[], expected: string[]) =>
    canonical([...new Set(actual)].sort()) === canonical([...new Set(expected)].sort());
  const visit = (id: string, seen = new Set<string>()): void => {
    if (seen.has(id)) throw new Error('LINEAGE_CYCLE');
    const artifact = byId.get(id);
    if (!artifact || artifact.org_id !== orgId || artifact.run_id !== runId)
      throw new Error('BROKEN_LINEAGE');
    verifyArtifact(artifact);
    for (const input of artifact.input_refs) visit(input, new Set([...seen, id]));
  };
  artifacts.forEach((artifact) => visit(artifact.artifact_id));
  for (const artifact of artifacts) {
    const inputs = artifact.input_refs.map((id) => byId.get(id)!);
    const expectedSnapshots =
      artifact.kind === 'query_result'
        ? artifact.payload.rows.map((row) => row.snapshot_id)
        : inputs.flatMap((input) => input.snapshot_refs);
    const expectedSources =
      artifact.kind === 'query_result'
        ? artifact.payload.rows.map((row) => row.import_id)
        : inputs.flatMap((input) => input.source_refs);
    if (
      !sameIds(artifact.snapshot_refs, expectedSnapshots) ||
      !sameIds(artifact.source_refs, expectedSources)
    )
      throw new Error('NON_UPSTREAM_LINEAGE_REFERENCE');
  }
  const calc = byId.get(report.calculation_artifact_id);
  const chart = byId.get(report.chart_artifact_id);
  const comparison = byId.get(report.comparison_artifact_id);
  if (
    calc?.kind !== 'calculation' ||
    chart?.kind !== 'visual_evidence' ||
    comparison?.kind !== 'comparison'
  )
    throw new Error('INVALID_REPORT_REFERENCES');
  if (
    artifacts.some(
      (artifact) =>
        artifact.data_as_of !== calc.data_as_of ||
        artifact.semantic_version !== calc.semantic_version,
    )
  )
    throw new Error('INCOMPATIBLE_ARTIFACT_VERSION');
  if (
    canonical(report.metrics) !== canonical(calc.payload.metrics) ||
    canonical(report.units) !== canonical(calc.payload.units)
  )
    throw new Error('REPORT_RECALCULATED_OR_CHANGED');
  const required = MetricKeySchema.options;
  if (
    calc.payload.metrics.length !== required.length ||
    required.some((k) => calc.payload.metrics.filter((m) => m.key === k).length !== 1)
  )
    throw new Error('INVALID_METRIC_SET');
  const claims = bindClaims(calc);
  if (
    report.claims.length !== claims.length ||
    report.claims.some(
      (claim) => !claims.some((expected) => canonical(expected) === canonical(claim)),
    )
  )
    throw new Error('UNGROUNDED_CLAIM');
  for (const claim of report.claims) {
    const source = byId.get(claim.evidence_artifact_id);
    if (source?.kind !== 'calculation') throw new Error('UNGROUNDED_CLAIM');
    const value = readArtifactPath(source, claim.evidence_path);
    if (canonical(value) !== canonical(claim.value)) throw new Error('UNGROUNDED_CLAIM');
  }
  if (report.summary !== SAFE_SUMMARY) throw new Error('UNVALIDATED_NARRATIVE');
  if (
    !chart.input_refs.includes(calc.artifact_id) ||
    !chart.input_refs.includes(comparison.artifact_id)
  )
    throw new Error('INVALID_CHART_LINEAGE');
  for (const spec of chart.payload.charts) {
    for (const inputId of spec.provenance.input_artifact_ids)
      if (!chart.input_refs.includes(inputId)) throw new Error('INVALID_CHART_LINEAGE');
    for (const binding of spec.provenance.bindings) {
      const source = byId.get(binding.artifact_id);
      if (!source) throw new Error('INVALID_CHART_LINEAGE');
      if (source.kind !== 'calculation' && source.kind !== 'comparison')
        throw new Error('INVALID_CHART_SOURCE_KIND');
      const expected = readArtifactPath(source, binding.evidence_path);
      const actual = spec.data[binding.data_index]?.[binding.data_key];
      const numeric =
        typeof expected === 'number' || typeof expected === 'string' ? Number(expected) : NaN;
      if (!Number.isFinite(numeric) || typeof actual !== 'number' || actual !== numeric)
        throw new Error('INVALID_CHART_VALUES');
    }
  }
  const peerCalc = byId.get(comparison.payload.calculation_artifact_id);
  if (
    peerCalc?.kind !== 'comparison_calculation' ||
    !comparison.input_refs.includes(peerCalc.artifact_id) ||
    canonical(comparison.payload.items) !== canonical(peerCalc.payload.items)
  )
    throw new Error('INVALID_COMPARISON_LINEAGE');
  if (
    canonical(comparison.payload.period_comparisons) !==
      canonical(calc.payload.period_comparisons) ||
    canonical(comparison.payload.segment_comparisons) !==
      canonical(calc.payload.segment_comparisons)
  )
    throw new Error('INVALID_TYPED_COMPARISON');
  const insight = artifacts.find((artifact) => artifact.kind === 'insight');
  if (
    insight?.kind !== 'insight' ||
    canonical(insight.payload.claims) !== canonical(report.claims) ||
    canonical(insight.payload.candidate_ids) !==
      canonical(calc.payload.insight_candidates.map((candidate) => candidate.candidate_id))
  )
    throw new Error('INVALID_INSIGHT_LINEAGE');
  if (
    report.sections.some(
      (section) =>
        section.artifact_refs.some((id) => !byId.has(id)) ||
        section.metric_keys.some(
          (key) => !calc.payload.metrics.some((metric) => metric.key === key),
        ),
    )
  )
    throw new Error('INVALID_REPORT_SECTION');
  const queryResult = artifacts.find((a) => a.kind === 'query_result');
  const query = artifacts.find((a) => a.kind === 'query');
  if (
    queryResult?.kind !== 'query_result' ||
    !query ||
    !queryResult.input_refs.includes(query.artifact_id) ||
    !calc.input_refs.includes(queryResult.artifact_id)
  )
    throw new Error('MISSING_QUERY_LINEAGE');
  if (
    queryResult.payload.rows.some(
      (r) =>
        r.org_id !== orgId ||
        !queryResult.snapshot_refs.includes(r.snapshot_id) ||
        !queryResult.source_refs.includes(r.import_id),
    )
  )
    throw new Error('INVALID_SOURCE_LINEAGE');
}

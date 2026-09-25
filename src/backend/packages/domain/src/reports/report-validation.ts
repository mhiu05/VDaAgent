import { DecisionBriefSchema, type DecisionBrief } from '@vda/contracts/decision/brief';
import { MetricKeySchema } from '@vda/contracts/analysis/metrics';
import { ReportPayloadSchema, type ReportPayload } from '@vda/contracts/reports/report';
import type { Artifact, ArtifactOf } from '@vda/contracts/artifacts/artifact';
import type { Scope } from '@vda/contracts/common/primitives';
import { buildDecisionBrief } from '@vda/semantic/decisions/build-decision-brief';
import { canonical, readArtifactPath, verifyArtifact } from '../artifacts/integrity';
import { bindClaims } from '../analysis/claim-binding';

export const SAFE_SUMMARY =
  'Kết quả mô tả tồn kho trong phạm vi và ngày dữ liệu đã chọn. Cần kiểm tra bằng chứng và giới hạn dữ liệu trước khi ra quyết định.';
export function validateDecisionBrief(
  brief: DecisionBrief,
  calculation: ArtifactOf<'calculation'>,
  orgId: string,
  runId: string,
  scope: Scope,
  requestedDataAsOf: string,
): void {
  DecisionBriefSchema.parse(brief);
  if (calculation.org_id !== orgId || calculation.run_id !== runId)
    throw new Error('CROSS_RUN_DECISION_BRIEF');
  const signals = [
    ...brief.current_state,
    ...brief.material_changes,
    ...brief.where_to_look,
    ...brief.data_quality,
  ];
  for (const signal of signals) {
    for (const evidence of signal.evidence) {
      if (evidence.artifact_id !== calculation.artifact_id)
        throw new Error('CROSS_RUN_DECISION_BRIEF');
      readArtifactPath(calculation, evidence.path);
    }
  }
  const expected = buildDecisionBrief(
    calculation.payload,
    calculation.artifact_id,
    scope,
    requestedDataAsOf,
  );
  if (canonical(brief) !== canonical(expected)) throw new Error('INVALID_DECISION_BRIEF');
}

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
  if (report.decision_brief !== undefined) {
    const request = artifacts.find((artifact) => artifact.kind === 'analysis_request');
    if (request?.kind !== 'analysis_request') throw new Error('MISSING_REQUEST_LINEAGE');
    validateDecisionBrief(
      report.decision_brief,
      calc,
      orgId,
      runId,
      request.payload.scope,
      request.payload.data_as_of,
    );
  }
  if (report.decision_intelligence_artifact_id !== undefined) {
    const decision = byId.get(report.decision_intelligence_artifact_id);
    if (decision?.kind !== 'decision_intelligence_pack')
      throw new Error('INVALID_DECISION_INTELLIGENCE_REFERENCE');
  }
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

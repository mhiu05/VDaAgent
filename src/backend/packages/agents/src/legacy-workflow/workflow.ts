import {
  ArtifactSchema,
  ARTIFACT_SCHEMA_VERSION,
  LIMITATION,
  SEMANTIC_VERSION,
  type Artifact,
  type ArtifactKind,
  type ArtifactOf,
  type RunTask,
} from '@vda/contracts';
import type { Lease, Repository } from '@vda/db';
import { analyze, buildDecisionBrief, compare, selectLatest, semanticPack } from '@vda/semantic';
import { artifactHash, bindClaims, stableId, validateReport, verifyArtifact } from '@vda/domain';
import { createProvider, type NarrativeProvider } from './narrative/provider';
import {
  ChartBuilder,
  chartPayloadFingerprint,
  validateVisualEvidence,
} from '../analysis/chart-builder';
import { reportSections } from '@vda/domain';
import { DAG } from './dag';

export async function executeLease(
  repository: Repository,
  lease: Lease,
  provider?: NarrativeProvider,
): Promise<void> {
  const { run } = lease;
  const chosenProvider = provider ?? createProvider();
  const existing = await repository.artifacts(run.created_by, run.org_id, run.run_id);
  const artifacts = new Map<ArtifactKind, Artifact>();
  for (const artifact of existing.artifacts) {
    verifyArtifact(artifact);
    artifacts.set(artifact.kind, artifact);
  }
  const { tasks: persistedTasks } = await repository.getRun(run.created_by, run.org_id, run.run_id);
  const tasks = new Map(persistedTasks.map((task) => [task.kind, task]));
  let active: RunTask['kind'] = 'orchestrator';
  async function task(
    kind: RunTask['kind'],
    status: RunTask['status'],
    error: string | null = null,
  ) {
    active = kind;
    await repository.assertLease(lease);
    const spec = DAG.find((step) => step.kind === kind)!;
    const previous = tasks.get(kind);
    const value: RunTask = {
      task_id: previous?.task_id ?? stableId(`${run.run_id}:task:${kind}`),
      run_id: run.run_id,
      org_id: run.org_id,
      kind,
      dependencies: spec.dependencies,
      status,
      attempt: run.attempt,
      error_code: error,
    };
    if (
      status === 'running' &&
      spec.dependencies.some((dep) => tasks.get(dep)?.status !== 'succeeded')
    )
      throw new Error('UNVALIDATED_DEPENDENCY');
    await repository.setTask(lease, value);
    tasks.set(kind, value);
    await repository.addEvent(lease, `${kind}: ${status}`, value.task_id);
  }
  async function put<K extends ArtifactKind>(
    kind: K,
    taskKind: RunTask['kind'],
    payload: ArtifactOf<K>['payload'],
    inputs: Artifact[],
    refs?: { snapshots: string[]; sources: string[] },
  ): Promise<ArtifactOf<K>> {
    await repository.assertLease(lease);
    const existingArtifact = artifacts.get(kind);
    if (existingArtifact) {
      verifyArtifact(existingArtifact);
      await repository.validateArtifact(lease, {
        artifact_id: existingArtifact.artifact_id,
        org_id: run.org_id,
        run_id: run.run_id,
        validated_at: new Date().toISOString(),
        validator_version: 'mvp-validator-v1',
        valid: true,
        checks: ['schema', 'hash', 'tenant', 'lineage'],
      });
      return existingArtifact as ArtifactOf<K>;
    }
    const unique = (values: string[]) => [...new Set(values)].sort();
    const body = {
      artifact_id: stableId(`${run.run_id}:artifact:${kind}`),
      org_id: run.org_id,
      run_id: run.run_id,
      task_id: tasks.get(taskKind)!.task_id,
      kind,
      schema_version: ARTIFACT_SCHEMA_VERSION,
      created_at: run.created_at,
      semantic_version: SEMANTIC_VERSION,
      provisional: true as const,
      data_as_of: run.request.data_as_of,
      input_refs: inputs.map((a) => a.artifact_id),
      snapshot_refs: unique(refs?.snapshots ?? inputs.flatMap((a) => a.snapshot_refs)),
      source_refs: unique(refs?.sources ?? inputs.flatMap((a) => a.source_refs)),
      limitations: [
        LIMITATION,
        'Missing available_since remains null; cohorts with fewer than three peers abstain.',
        ...(artifacts.get('query_result')?.snapshot_refs.length === 0
          ? ['No snapshot exists at the selected date and scope; affected metrics remain null.']
          : []),
      ],
      payload,
    };
    const artifact = ArtifactSchema.parse({
      ...body,
      content_hash: artifactHash(body as Omit<Artifact, 'content_hash'>),
    }) as ArtifactOf<K>;
    verifyArtifact(artifact);
    const persisted = await repository.storeArtifact(lease, artifact);
    await repository.validateArtifact(lease, {
      artifact_id: persisted.artifact_id,
      org_id: run.org_id,
      run_id: run.run_id,
      validated_at: new Date().toISOString(),
      validator_version: 'mvp-validator-v1',
      valid: true,
      checks: ['schema', 'hash', 'tenant', 'lineage'],
    });
    artifacts.set(kind, persisted);
    return persisted as ArtifactOf<K>;
  }
  try {
    await repository.renewLease(lease);
    await task('orchestrator', 'running');
    const request = await put('analysis_request', 'orchestrator', run.request, []);
    const plan = await put(
      'analysis_plan',
      'orchestrator',
      { steps: DAG, scope: run.request.scope },
      [request],
    );
    await task('orchestrator', 'succeeded');
    await task('data', 'running');
    let queryResult = artifacts.get('query_result') as ArtifactOf<'query_result'> | undefined;
    if (!queryResult) {
      const result = await repository.readSnapshots(lease);
      if (result.rows.length > result.row_limit) throw new Error('QUERY_ROW_LIMIT');
      if (!/^\s*(SELECT|WITH)\b/i.test(result.sql) || /;\s*\S/.test(result.sql))
        throw new Error('UNSAFE_QUERY');
      if (result.rows.some((r) => r.org_id !== run.org_id))
        throw new Error('CROSS_TENANT_SNAPSHOT');
      const query = await put(
        'query',
        'data',
        {
          sql: result.sql,
          parameters: result.parameters,
          row_limit: result.row_limit,
          timeout_ms: result.timeout_ms,
        },
        [plan],
      );
      queryResult = await put(
        'query_result',
        'data',
        { rows: result.rows, row_count: result.rows.length, truncated: false },
        [query],
        {
          snapshots: result.rows.map((r) => r.snapshot_id),
          sources: result.rows.map((r) => r.import_id),
        },
      );
    } else {
      // Recover a crash between immutable persistence and the validation projection.
      queryResult = await put(
        'query_result',
        'data',
        queryResult.payload,
        queryResult.input_refs.map((id) =>
          [...artifacts.values()].find((a) => a.artifact_id === id)!,
        ),
      );
    }
    await task('data', 'succeeded');
    await task('calculation', 'running');
    const config = await repository.getMetricConfig(lease);
    const calculation = await put(
      'calculation',
      'calculation',
      analyze(
        queryResult.payload.rows,
        run.org_id,
        run.request.scope,
        run.request.data_as_of,
        config.slow_moving_threshold_days,
      ),
      [queryResult],
    );
    await task('calculation', 'succeeded');
    await task('comparison', 'running');
    const numeric = await put(
      'comparison_calculation',
      'comparison',
      {
        items: compare(
          selectLatest(
            queryResult.payload.rows,
            run.org_id,
            run.request.data_as_of,
            run.request.scope,
          ),
        ),
        rounding: 'decimal-half-up-6dp',
        rule: semanticPack.peer_rule,
      },
      [queryResult, calculation],
    );
    const comparison = await put(
      'comparison',
      'comparison',
      {
        items: numeric.payload.items,
        period_comparisons: calculation.payload.period_comparisons,
        segment_comparisons: calculation.payload.segment_comparisons,
        calculation_artifact_id: numeric.artifact_id,
      },
      [numeric],
    );
    await task('comparison', 'succeeded');
    await task('chart', 'running');
    const chartPayload = new ChartBuilder().build({ calculation, comparison });
    validateVisualEvidence(chartPayload, [calculation, comparison]);
    const chart = await put('visual_evidence', 'chart', chartPayload, [calculation, comparison]);
    if (chartPayloadFingerprint(chart.payload) !== chartPayloadFingerprint(chartPayload))
      throw new Error('IMMUTABLE_CHART_RULE_MISMATCH');
    await task('chart', 'succeeded');
    await repository.renewLease(lease);
    await task('insight', 'running');
    const boundClaims = bindClaims(calculation);
    const narrative =
      artifacts.get('insight')?.kind === 'insight'
        ? (artifacts.get('insight') as ArtifactOf<'insight'>).payload
        : await chosenProvider.narrate(boundClaims);
    const insight = await put(
      'insight',
      'insight',
      {
        summary: narrative.summary,
        claims: narrative.claims,
        candidate_ids: calculation.payload.insight_candidates.map((item) => item.candidate_id),
        provider: narrative.provider,
      },
      [calculation, comparison],
    );
    await task('insight', 'succeeded');
    await task('validation', 'running');
    const reportPayload = {
      title: `Inventory report · ${run.request.scope.zone_external_id ?? run.request.scope.project_external_id}`,
      summary: insight.payload.summary,
      claims: insight.payload.claims,
      metrics: calculation.payload.metrics,
      units: calculation.payload.units,
      calculation_artifact_id: calculation.artifact_id,
      chart_artifact_id: chart.artifact_id,
      comparison_artifact_id: comparison.artifact_id,
      sections: reportSections(calculation, chart, comparison, insight),
      limitations: [...calculation.limitations, ...calculation.payload.quality_limitations],
      decision_brief: buildDecisionBrief(
        calculation.payload,
        calculation.artifact_id,
        run.request.scope,
        run.request.data_as_of,
      ),
    };
    validateReport(reportPayload, [...artifacts.values()], run.org_id, run.run_id);
    const current = await repository.artifacts(run.created_by, run.org_id, run.run_id);
    for (const artifact of artifacts.values()) {
      if (!current.validations.some((v) => v.artifact_id === artifact.artifact_id && v.valid))
        throw new Error('UNVALIDATED_ARTIFACT');
      if (
        artifact.source_refs.some(
          (id) => !current.sources.some((s) => s.import_id === id && s.org_id === run.org_id),
        )
      )
        throw new Error('MISSING_IMPORT_MANIFEST');
    }
    await task('validation', 'succeeded');
    await task('report', 'running');
    const report = await put('report', 'report', reportPayload, [
      calculation,
      chart,
      comparison,
      insight,
    ]);
    await task('report', 'succeeded');
    await repository.completeRun(lease, report.artifact_id);
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'PIPELINE_FAILED';
    try {
      await task(active, 'failed', code);
    } catch {
      /* The lease may have expired or been cancelled; stale writes stay denied. */
    }
    try {
      await repository.failRun(lease, code);
    } catch {
      /* A new lease/cancellation owns the terminal state. */
    }
    throw error;
  }
}

import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactSchema,
  ChartSpecSchema,
  type Artifact,
  type ArtifactOf,
} from '@vda/contracts';
import {
  artifactHash,
  ChartBuilder,
  chartPayloadFingerprint,
  validateVisualEvidence,
} from '@vda/agents';
import { analyze, compare, selectLatest } from '@vda/semantic';
import { ORG, row } from '../fixtures/inventory';

const RUN = '50000000-0000-4000-8000-000000000001';
const CALCULATION_ID = '50000000-0000-4000-8000-000000000002';
const COMPARISON_ID = '50000000-0000-4000-8000-000000000003';
const TASK = '50000000-0000-4000-8000-000000000004';
const scope = { project_external_id: 'P-ALPHA', zone_external_id: null };

function history() {
  return ['2026-08-20', '2026-09-13', '2026-09-20'].flatMap((snapshotDate) =>
    ['A', 'B', 'C', 'D'].map((unit, index) =>
      row({
        snapshot_date: snapshotDate,
        unit_external_id: unit,
        unit_code: unit,
        unit_type: index < 2 ? 'apartment' : 'villa',
        list_price: String(2_000_000_000 + index * 100_000_000),
        area_sqm: '100',
        available_since: index === 3 ? null : index === 2 ? '2026-03-01' : '2026-08-01',
      }),
    ),
  );
}

function artifact<K extends 'calculation' | 'comparison'>(
  kind: K,
  id: string,
  payload: ArtifactOf<K>['payload'],
): ArtifactOf<K> {
  const body = {
    artifact_id: id,
    org_id: ORG,
    run_id: RUN,
    task_id: TASK,
    schema_version: ARTIFACT_SCHEMA_VERSION,
    created_at: '2026-09-20T00:00:00.000Z',
    semantic_version: 'mvp-inventory-v0.2' as const,
    provisional: true as const,
    data_as_of: '2026-09-20',
    input_refs: [],
    snapshot_refs: [],
    source_refs: [],
    limitations: [],
    kind,
    payload,
  };
  return ArtifactSchema.parse({
    ...body,
    content_hash: artifactHash(body as Omit<Artifact, 'content_hash'>),
  }) as ArtifactOf<K>;
}

function inputs() {
  const rows = history();
  const calculation = artifact(
    'calculation',
    CALCULATION_ID,
    analyze(rows, ORG, scope, '2026-09-20'),
  );
  const comparison = artifact('comparison', COMPARISON_ID, {
    items: compare(selectLatest(rows, ORG, '2026-09-20', scope)),
    period_comparisons: calculation.payload.period_comparisons,
    segment_comparisons: calculation.payload.segment_comparisons,
    calculation_artifact_id: '50000000-0000-4000-8000-000000000005',
  });
  return { calculation, comparison };
}

describe('deterministic visual evidence builder', () => {
  it('builds stable chart families, ordering, metric bindings, and fingerprints', () => {
    const source = inputs();
    const builder = new ChartBuilder();
    const first = builder.build(source);
    const second = builder.build(source);
    expect(second).toEqual(first);
    expect(chartPayloadFingerprint(second)).toBe(chartPayloadFingerprint(first));
    expect(first.charts.map((chart) => chart.chart_id)).toEqual(
      [...first.charts.map((chart) => chart.chart_id)].sort(),
    );
    expect(new Set(first.charts.map((chart) => chart.chart_type))).toEqual(
      new Set(['kpi', 'bar', 'line', 'donut']),
    );
    expect(
      first.charts
        .find((chart) => chart.chart_id === 'aging_distribution')
        ?.data.map((datum) => datum.bucket),
    ).toEqual(['0-30', '31-60', '61-90', '91-180', '>180', 'unknown']);
    expect(
      first.charts
        .find((chart) => chart.chart_id === 'inventory_trend')
        ?.data.map((datum) => datum.date),
    ).toEqual(['2026-08-21', '2026-09-13', '2026-09-20']);
    expect(() =>
      validateVisualEvidence(first, [source.calculation, source.comparison]),
    ).not.toThrow();
  });

  it('abstains for insufficient history and excessive composition cardinality', () => {
    const source = inputs();
    source.calculation.payload.period_comparisons = [];
    source.calculation.payload.current_snapshot_date = '2026-09-20';
    const breakdown = source.calculation.payload.breakdowns.find(
      (item) => item.dimension === 'unit_type' && item.metric_key === 'available_inventory',
    )!;
    breakdown.items = Array.from({ length: 9 }, (_, index) => ({
      key: `type-${index}`,
      label: `Type ${index}`,
      value: 1,
      currency: null,
      abstention_reason: null,
    }));
    const result = new ChartBuilder().build(source);
    expect(result.charts.some((chart) => chart.intent === 'inventory_trend')).toBe(false);
    expect(result.unavailable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          intent: 'inventory_trend',
          reason: 'INSUFFICIENT_HISTORY',
        }),
        expect.objectContaining({
          intent: 'inventory_composition',
          reason: 'TOO_MANY_CATEGORIES',
        }),
      ]),
    );
  });

  it('labels trend points by their as-of targets and preserves a valid zero baseline', () => {
    const rows = ['2026-08-20', '2026-09-12', '2026-09-20'].map((snapshotDate, index) =>
      row({
        unit_external_id: 'trend-unit',
        snapshot_date: snapshotDate,
        status: index === 1 ? 'sold' : 'available',
        sold_at: index === 1 ? snapshotDate : null,
      }),
    );
    const calculation = artifact(
      'calculation',
      CALCULATION_ID,
      analyze(rows, ORG, scope, '2026-09-20'),
    );
    const comparison = artifact('comparison', COMPARISON_ID, {
      items: compare(selectLatest(rows, ORG, '2026-09-20', scope)),
      period_comparisons: calculation.payload.period_comparisons,
      segment_comparisons: calculation.payload.segment_comparisons,
      calculation_artifact_id: '50000000-0000-4000-8000-000000000005',
    });
    const trend = new ChartBuilder()
      .build({ calculation, comparison })
      .charts.find((chart) => chart.chart_id === 'inventory_trend')!;
    expect(trend.data.map((datum) => datum.date)).toEqual([
      '2026-08-21',
      '2026-09-13',
      '2026-09-20',
    ]);
    expect(trend.data.map((datum) => datum.value)).toEqual([1, 0, 1]);
  });

  it('does not create an aging chart from an empty all-zero bucket template', () => {
    const calculation = artifact(
      'calculation',
      CALCULATION_ID,
      analyze([], ORG, scope, '2026-09-20'),
    );
    const comparison = artifact('comparison', COMPARISON_ID, {
      items: [],
      period_comparisons: calculation.payload.period_comparisons,
      segment_comparisons: calculation.payload.segment_comparisons,
      calculation_artifact_id: '50000000-0000-4000-8000-000000000005',
    });
    const evidence = new ChartBuilder().build({ calculation, comparison });
    expect(evidence.charts.some((chart) => chart.intent === 'aging_distribution')).toBe(false);
    expect(evidence.unavailable).toContainEqual(
      expect.objectContaining({ intent: 'aging_distribution', reason: 'NO_DATA' }),
    );
  });

  it('rejects tampered datapoints, cross-tenant inputs, and incompatible dates', () => {
    const source = inputs();
    const payload = new ChartBuilder().build(source);
    const tampered = structuredClone(payload);
    tampered.charts[0].data[0].value = 999;
    expect(() => validateVisualEvidence(tampered, [source.calculation, source.comparison])).toThrow(
      'INVALID_CHART_VALUE',
    );
    const foreign = structuredClone(source.comparison);
    foreign.org_id = '10000000-0000-4000-8000-000000000002';
    expect(() => validateVisualEvidence(payload, [source.calculation, foreign])).toThrow(
      'INCOMPATIBLE_CHART_INPUT',
    );
    const wrongDate = structuredClone(source.comparison);
    wrongDate.data_as_of = '2026-09-19';
    expect(() => validateVisualEvidence(payload, [source.calculation, wrongDate])).toThrow(
      'INCOMPATIBLE_CHART_INPUT',
    );
  });
});

describe('ChartSpec structural and semantic validation', () => {
  const valid = () =>
    new ChartBuilder().build(inputs()).charts.find((chart) => chart.chart_type === 'line')!;

  it('rejects NaN, Infinity, missing keys, duplicate series, and unordered dates', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalid = structuredClone(valid());
      invalid.data[0].value = value;
      expect(ChartSpecSchema.safeParse(invalid).success).toBe(false);
    }
    const missing = structuredClone(valid());
    delete missing.data[0].value;
    expect(ChartSpecSchema.safeParse(missing).success).toBe(false);
    const duplicate = structuredClone(valid());
    duplicate.series.push(structuredClone(duplicate.series[0]));
    expect(ChartSpecSchema.safeParse(duplicate).success).toBe(false);
    const unordered = structuredClone(valid());
    unordered.data.reverse();
    expect(ChartSpecSchema.safeParse(unordered).success).toBe(false);
  });

  it('rejects invalid composition and scatter values', () => {
    const donut = new ChartBuilder()
      .build(inputs())
      .charts.find((chart) => chart.chart_type === 'donut')!;
    donut.data[0].value = -1;
    expect(ChartSpecSchema.safeParse(donut).success).toBe(false);
    const scatter = structuredClone(valid());
    scatter.chart_type = 'scatter';
    scatter.x_axis = { key: 'date', label: null, value_type: 'number' };
    expect(ChartSpecSchema.safeParse(scatter).success).toBe(false);
  });
});

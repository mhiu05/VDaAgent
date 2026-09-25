import {
  CHART_RULES_VERSION,
  CHART_SPEC_VERSION,
  ChartSpecSchema,
  VisualEvidencePayloadSchema,
  type Artifact,
  type ArtifactOf,
  type ChartIntent,
  type ChartSeries,
  type ChartSpec,
  type ChartUnavailable,
  type ChartValueFormat,
  type MetricKey,
  type MetricUnit,
  type VisualEvidencePayload,
} from '@vda/contracts';
import { canonical, readArtifactPath } from '@vda/domain';
import { getMetricDefinition } from '@vda/semantic';

const MAX_COMPOSITION_CATEGORIES = 8;
const MAX_COMPARISON_CATEGORIES = 12;
const KPI_METRICS: MetricKey[] = [
  'available_inventory',
  'sold_units_30d',
  'slow_moving_rate',
  'median_inventory_age_days',
  'median_price_per_area',
];

type Inputs = {
  calculation: ArtifactOf<'calculation'>;
  comparison?: ArtifactOf<'comparison'>;
};

type BoundValue = {
  value: number;
  artifactId: string;
  evidencePath: string;
  metricKey: MetricKey;
};

function numberValue(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueFormat(unit: MetricUnit): ChartValueFormat {
  if (unit === 'count') return 'integer';
  if (unit === 'percent') return 'percent';
  if (unit === 'percentage_points') return 'percentage_points';
  if (unit === 'days') return 'days';
  if (unit === 'currency') return 'currency';
  return 'currency_per_area';
}

function series(
  key: string,
  label: string,
  metricKey: MetricKey | null,
  unit: MetricUnit,
  currency: string | null = null,
): ChartSeries {
  return {
    key,
    label,
    metric_key: metricKey,
    unit,
    currency,
    value_format: valueFormat(unit),
    stack: null,
  };
}

function unavailable(
  intent: ChartIntent,
  reason: ChartUnavailable['reason'],
  message: string,
  metricKeys: MetricKey[],
): ChartUnavailable {
  return { intent, reason, message, metric_keys: metricKeys, limitations: [] };
}

function chart(value: Omit<ChartSpec, 'version' | 'rules_version' | 'generated_by'>): ChartSpec {
  return ChartSpecSchema.parse({
    ...value,
    version: CHART_SPEC_VERSION,
    rules_version: CHART_RULES_VERSION,
    generated_by: 'deterministic',
  });
}

function provenance(values: BoundValue[]) {
  return {
    input_artifact_ids: [...new Set(values.map((item) => item.artifactId))].sort(),
    metric_keys: [...new Set(values.map((item) => item.metricKey))].sort(),
    bindings: values.map((item, dataIndex) => ({
      data_index: dataIndex,
      data_key: 'value',
      artifact_id: item.artifactId,
      evidence_path: item.evidencePath,
      metric_key: item.metricKey,
    })),
  };
}

function buildKpis(calculation: ArtifactOf<'calculation'>): {
  charts: ChartSpec[];
  unavailable: ChartUnavailable[];
} {
  const charts: ChartSpec[] = [];
  for (const metricKey of KPI_METRICS) {
    const index = calculation.payload.metrics.findIndex((metric) => metric.key === metricKey);
    const metric = calculation.payload.metrics[index];
    const value = metric ? numberValue(metric.value) : null;
    if (!metric || value === null) continue;
    const bound = {
      value,
      artifactId: calculation.artifact_id,
      evidencePath: `payload.metrics[${index}].value`,
      metricKey,
    };
    charts.push(
      chart({
        chart_id: `kpi_${metricKey}`,
        intent: 'inventory_kpi',
        chart_type: 'kpi',
        title: metric.label,
        subtitle: calculation.data_as_of,
        purpose: metric.description,
        x_axis: null,
        y_axis: { label: metric.label, unit: metric.unit, min: null, max: null },
        series: [series('value', metric.label, metricKey, metric.unit, metric.currency)],
        data: [{ label: metric.label, value }],
        provenance: provenance([bound]),
        limitations:
          metricKey === 'slow_moving_rate' || metricKey === 'median_inventory_age_days'
            ? calculation.payload.quality_limitations
            : [],
      }),
    );
  }
  return {
    charts,
    unavailable: charts.length
      ? []
      : [
          unavailable(
            'inventory_kpi',
            'NO_DATA',
            'No validated current metric is available for KPI evidence.',
            KPI_METRICS,
          ),
        ],
  };
}

function buildTrend(calculation: ArtifactOf<'calculation'>): ChartSpec | ChartUnavailable {
  const metricKey: MetricKey = 'available_inventory';
  const metricIndex = calculation.payload.metrics.findIndex((metric) => metric.key === metricKey);
  const currentMetric = calculation.payload.metrics[metricIndex];
  const currentValue = currentMetric ? numberValue(currentMetric.value) : null;
  const byDate = new Map<string, BoundValue>();
  calculation.payload.period_comparisons.forEach((comparison, index) => {
    if (
      comparison.metric_key !== metricKey ||
      comparison.abstention_reason !== null ||
      comparison.comparison_value === null
    )
      return;
    const value = numberValue(comparison.comparison_value);
    if (value === null || byDate.has(comparison.comparison_target_date)) return;
    byDate.set(comparison.comparison_target_date, {
      value,
      artifactId: calculation.artifact_id,
      evidencePath: `payload.period_comparisons[${index}].comparison_value`,
      metricKey,
    });
  });
  if (currentValue !== null)
    byDate.set(calculation.data_as_of, {
      value: currentValue,
      artifactId: calculation.artifact_id,
      evidencePath: `payload.metrics[${metricIndex}].value`,
      metricKey,
    });
  const points = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (points.length < 2)
    return unavailable(
      'inventory_trend',
      'INSUFFICIENT_HISTORY',
      'At least two distinct validated snapshot dates are required for a line chart.',
      [metricKey],
    );
  const values = points.map(([, value]) => value);
  return chart({
    chart_id: 'inventory_trend',
    intent: 'inventory_trend',
    chart_type: 'line',
    title: 'Available inventory trend',
    subtitle: null,
    purpose: 'Show validated latest-at-or-before inventory values at each as-of target date.',
    x_axis: { key: 'date', label: 'As-of date', value_type: 'date' },
    y_axis: { label: 'Available inventory', unit: 'count', min: 0, max: null },
    series: [series('value', 'Available inventory', metricKey, 'count')],
    data: points.map(([date, item]) => ({ date, value: item.value })),
    provenance: provenance(values),
    limitations: [],
  });
}

function buildAging(calculation: ArtifactOf<'calculation'>): ChartSpec | ChartUnavailable {
  const metricKey: MetricKey = 'available_inventory';
  if (
    !calculation.payload.age_buckets.length ||
    calculation.payload.age_buckets.every((bucket) => bucket.value === 0)
  )
    return unavailable(
      'aging_distribution',
      'NO_DATA',
      'No validated inventory-age buckets are available.',
      [metricKey],
    );
  const values = calculation.payload.age_buckets.map((bucket, index) => ({
    value: bucket.value,
    artifactId: calculation.artifact_id,
    evidencePath: `payload.age_buckets[${index}].value`,
    metricKey,
  }));
  return chart({
    chart_id: 'aging_distribution',
    intent: 'aging_distribution',
    chart_type: 'bar',
    title: 'Inventory age distribution',
    subtitle: 'Semantic bucket order is preserved',
    purpose: 'Compare available inventory across validated age buckets.',
    x_axis: { key: 'bucket', label: 'Age bucket (days)', value_type: 'category' },
    y_axis: { label: 'Units', unit: 'count', min: 0, max: null },
    series: [series('value', 'Available units', metricKey, 'count')],
    data: calculation.payload.age_buckets.map((bucket) => ({
      bucket: bucket.bucket,
      value: bucket.value,
    })),
    provenance: provenance(values),
    limitations: calculation.payload.quality_limitations,
  });
}

function breakdownChart(
  calculation: ArtifactOf<'calculation'>,
  intent: 'slow_moving_by_segment' | 'inventory_composition',
  dimension: 'zone' | 'unit_type',
  metricKey: 'slow_moving_rate' | 'available_inventory',
): ChartSpec | ChartUnavailable {
  const breakdownIndex = calculation.payload.breakdowns.findIndex(
    (item) => item.dimension === dimension && item.metric_key === metricKey,
  );
  const breakdown = calculation.payload.breakdowns[breakdownIndex];
  if (!breakdown)
    return unavailable(intent, 'NO_DATA', 'The required validated breakdown is unavailable.', [
      metricKey,
    ]);
  if (intent === 'inventory_composition' && breakdown.items.length > MAX_COMPOSITION_CATEGORIES)
    return unavailable(
      intent,
      'TOO_MANY_CATEGORIES',
      `Composition charts are limited to ${MAX_COMPOSITION_CATEGORIES} categories.`,
      [metricKey],
    );
  const items = breakdown.items.flatMap((item, itemIndex) => {
    const value = numberValue(item.value);
    return value === null ? [] : [{ item, itemIndex, value }];
  });
  if (
    !items.length ||
    (intent === 'inventory_composition' && !items.some((item) => item.value > 0))
  )
    return unavailable(intent, 'NO_DATA', 'The validated breakdown has no plottable values.', [
      metricKey,
    ]);
  const unit = getMetricDefinition(metricKey).unit;
  const values = items.map(({ itemIndex, value }) => ({
    value,
    artifactId: calculation.artifact_id,
    evidencePath: `payload.breakdowns[${breakdownIndex}].items[${itemIndex}].value`,
    metricKey,
  }));
  return chart({
    chart_id: intent,
    intent,
    chart_type: intent === 'inventory_composition' ? 'donut' : 'bar',
    title:
      intent === 'inventory_composition'
        ? 'Available inventory composition by unit type'
        : 'Slow-moving rate by zone',
    subtitle: null,
    purpose:
      intent === 'inventory_composition'
        ? 'Show a validated part-to-whole composition with bounded cardinality.'
        : 'Compare the validated slow-moving rate across zones.',
    x_axis: { key: 'label', label: dimension, value_type: 'category' },
    y_axis: { label: getMetricDefinition(metricKey).label, unit, min: 0, max: null },
    series: [series('value', getMetricDefinition(metricKey).label, metricKey, unit)],
    data: items.map(({ item, value }) => ({ label: item.label, value })),
    provenance: provenance(values),
    limitations: breakdown.limitations,
  });
}

function buildPrice(calculation: ArtifactOf<'calculation'>): ChartSpec | ChartUnavailable {
  const metricKeys: MetricKey[] = [
    'p25_price_per_area',
    'median_price_per_area',
    'p75_price_per_area',
  ];
  const values = metricKeys.flatMap((metricKey) => {
    const index = calculation.payload.metrics.findIndex((metric) => metric.key === metricKey);
    const metric = calculation.payload.metrics[index];
    const value = metric ? numberValue(metric.value) : null;
    return metric && value !== null ? [{ metric, metricKey, value, index }] : [];
  });
  if (values.length !== metricKeys.length)
    return unavailable(
      'price_distribution',
      'MISSING_REQUIRED_FIELD',
      'P25, median, and P75 price-per-area metrics must all be available.',
      metricKeys,
    );
  const currencies = [...new Set(values.map(({ metric }) => metric.currency))];
  if (currencies.length !== 1 || currencies[0] === null)
    return unavailable(
      'price_distribution',
      'INCOMPARABLE_CURRENCY',
      'Price quartiles require one explicit currency.',
      metricKeys,
    );
  return chart({
    chart_id: 'price_distribution',
    intent: 'price_distribution',
    chart_type: 'bar',
    title: 'Price per area distribution',
    subtitle: 'Validated quartile summary',
    purpose: 'Compare validated price-per-area quartiles without recalculating them.',
    x_axis: { key: 'label', label: 'Statistic', value_type: 'category' },
    y_axis: { label: 'Price per m²', unit: 'currency_per_sqm', min: 0, max: null },
    series: [series('value', 'Price per m²', null, 'currency_per_sqm', currencies[0])],
    data: values.map(({ metric, value }) => ({ label: metric.label, value })),
    provenance: provenance(
      values.map(({ metricKey, value, index }) => ({
        value,
        artifactId: calculation.artifact_id,
        evidencePath: `payload.metrics[${index}].value`,
        metricKey,
      })),
    ),
    limitations: [],
  });
}

function buildPeerComparison(inputs: Inputs): ChartSpec | ChartUnavailable {
  const metricKey: MetricKey = 'median_price_per_area';
  if (!inputs.comparison)
    return unavailable(
      'peer_comparison',
      'INSUFFICIENT_PEERS',
      'No validated peer-comparison artifact is available.',
      [metricKey],
    );
  const items = inputs.comparison.payload.items.flatMap((item, itemIndex) => {
    const unitIndex = inputs.calculation.payload.units.findIndex(
      (unit) => unit.unit_external_id === item.unit_external_id,
    );
    const target = numberValue(inputs.calculation.payload.units[unitIndex]?.price_per_sqm ?? null);
    const peer = numberValue(item.median_price_per_sqm);
    return item.abstention_reason === null && target !== null && peer !== null
      ? [{ item, itemIndex, unitIndex, target, peer }]
      : [];
  });
  if (!items.length)
    return unavailable(
      'peer_comparison',
      'INSUFFICIENT_PEERS',
      'No unit has a valid target value and a validated peer median.',
      [metricKey],
    );
  if (items.length > MAX_COMPARISON_CATEGORIES)
    return unavailable(
      'peer_comparison',
      'TOO_MANY_CATEGORIES',
      `Peer comparison is limited to ${MAX_COMPARISON_CATEGORIES} units.`,
      [metricKey],
    );
  const currencies = [...new Set(items.map(({ item }) => item.currency))].filter(Boolean);
  if (currencies.length !== 1)
    return unavailable(
      'peer_comparison',
      'INCOMPARABLE_CURRENCY',
      'Peer observations must share one currency to use a common chart axis.',
      [metricKey],
    );
  const inputIds = [inputs.calculation.artifact_id, inputs.comparison.artifact_id].sort();
  const bindings = items.flatMap(({ itemIndex, unitIndex }, dataIndex) => [
    {
      data_index: dataIndex,
      data_key: 'subject',
      artifact_id: inputs.calculation.artifact_id,
      evidence_path: `payload.units[${unitIndex}].price_per_sqm`,
      metric_key: metricKey,
    },
    {
      data_index: dataIndex,
      data_key: 'peer_median',
      artifact_id: inputs.comparison!.artifact_id,
      evidence_path: `payload.items[${itemIndex}].median_price_per_sqm`,
      metric_key: metricKey,
    },
  ]);
  return chart({
    chart_id: 'peer_comparison',
    intent: 'peer_comparison',
    chart_type: 'bar',
    title: 'Unit price per area vs peer median',
    subtitle: null,
    purpose: 'Compare each compatible unit observation with its validated cohort median.',
    x_axis: { key: 'unit', label: 'Unit', value_type: 'category' },
    y_axis: { label: 'Price per m²', unit: 'currency_per_sqm', min: 0, max: null },
    series: [
      series('subject', 'Subject unit', metricKey, 'currency_per_sqm', currencies[0]),
      series('peer_median', 'Peer median', metricKey, 'currency_per_sqm', currencies[0]),
    ],
    data: items.map(({ item, target, peer }) => ({
      unit: item.unit_external_id,
      subject: target,
      peer_median: peer,
    })),
    provenance: { input_artifact_ids: inputIds, metric_keys: [metricKey], bindings },
    limitations: ['Visual comparison is descriptive and does not imply causation.'],
  });
}

function evidenceCurrency(artifact: Artifact, path: string): string | null {
  if (artifact.kind === 'calculation') {
    const metric = path.match(/^payload\.metrics\[(\d+)\]\.value$/);
    if (metric) return artifact.payload.metrics[Number(metric[1])]?.currency ?? null;
    const unit = path.match(/^payload\.units\[(\d+)\]\.price_per_sqm$/);
    if (unit) return artifact.payload.units[Number(unit[1])]?.currency ?? null;
    const breakdown = path.match(/^payload\.breakdowns\[(\d+)\]\.items\[(\d+)\]\.value$/);
    if (breakdown)
      return (
        artifact.payload.breakdowns[Number(breakdown[1])]?.items[Number(breakdown[2])]?.currency ??
        null
      );
  }
  if (artifact.kind === 'comparison') {
    const item = path.match(/^payload\.items\[(\d+)\]\.median_price_per_sqm$/);
    if (item) return artifact.payload.items[Number(item[1])]?.currency ?? null;
  }
  return null;
}

export function validateVisualEvidence(
  payload: VisualEvidencePayload,
  inputArtifacts: Artifact[],
): void {
  VisualEvidencePayloadSchema.parse(payload);
  const inputs = new Map(inputArtifacts.map((artifact) => [artifact.artifact_id, artifact]));
  if (inputs.size !== inputArtifacts.length) throw new Error('DUPLICATE_CHART_INPUT');
  const [first] = inputArtifacts;
  if (
    !first ||
    inputArtifacts.some(
      (artifact) =>
        artifact.org_id !== first.org_id ||
        artifact.run_id !== first.run_id ||
        artifact.data_as_of !== first.data_as_of ||
        artifact.semantic_version !== first.semantic_version,
    )
  )
    throw new Error('INCOMPATIBLE_CHART_INPUT');
  for (const spec of payload.charts) {
    for (const artifactId of spec.provenance.input_artifact_ids)
      if (!inputs.has(artifactId)) throw new Error('INVALID_CHART_LINEAGE');
    const boundCells = new Set<string>();
    for (const binding of spec.provenance.bindings) {
      const cell = `${binding.data_index}:${binding.data_key}`;
      if (boundCells.has(cell)) throw new Error('DUPLICATE_CHART_BINDING');
      boundCells.add(cell);
      const artifact = inputs.get(binding.artifact_id);
      if (!artifact) throw new Error('INVALID_CHART_LINEAGE');
      if (artifact.kind !== 'calculation' && artifact.kind !== 'comparison')
        throw new Error('INVALID_CHART_SOURCE_KIND');
      const expected = readArtifactPath(artifact, binding.evidence_path);
      const actual = spec.data[binding.data_index]?.[binding.data_key];
      const expectedNumber = numberValue(
        typeof expected === 'string' || typeof expected === 'number' ? expected : null,
      );
      if (expectedNumber === null || typeof actual !== 'number' || actual !== expectedNumber)
        throw new Error('INVALID_CHART_VALUE');
      const definition = getMetricDefinition(binding.metric_key);
      if (definition.unit === 'percent' && (actual < 0 || actual > 100))
        throw new Error('INVALID_PERCENTAGE_VALUE');
    }
    for (const seriesItem of spec.series) {
      if (seriesItem.unit === null) continue;
      const bindings = spec.provenance.bindings.filter(
        (binding) => binding.data_key === seriesItem.key,
      );
      if (
        bindings.some((binding) => getMetricDefinition(binding.metric_key).unit !== seriesItem.unit)
      )
        throw new Error('INVALID_CHART_UNIT');
      if (
        seriesItem.metric_key !== null &&
        getMetricDefinition(seriesItem.metric_key).unit !== seriesItem.unit
      )
        throw new Error('INVALID_CHART_UNIT');
      if (
        (seriesItem.unit === 'currency' || seriesItem.unit === 'currency_per_sqm') &&
        bindings.some(
          (binding) =>
            evidenceCurrency(inputs.get(binding.artifact_id)!, binding.evidence_path) !==
            seriesItem.currency,
        )
      )
        throw new Error('INVALID_CHART_CURRENCY');
    }
    if (
      spec.chart_type === 'line' &&
      spec.data.some((datum) => String(datum[spec.x_axis!.key]) > first.data_as_of)
    )
      throw new Error('FUTURE_CHART_POINT');
  }
}

export class ChartBuilder {
  build(inputs: Inputs): VisualEvidencePayload {
    const kpis = buildKpis(inputs.calculation);
    const candidates: Array<ChartSpec | ChartUnavailable> = [
      ...kpis.charts,
      ...kpis.unavailable,
      buildTrend(inputs.calculation),
      buildAging(inputs.calculation),
      breakdownChart(inputs.calculation, 'slow_moving_by_segment', 'zone', 'slow_moving_rate'),
      breakdownChart(
        inputs.calculation,
        'inventory_composition',
        'unit_type',
        'available_inventory',
      ),
      buildPrice(inputs.calculation),
      buildPeerComparison(inputs),
    ];
    const payload = VisualEvidencePayloadSchema.parse({
      chart_rules_version: CHART_RULES_VERSION,
      charts: candidates
        .filter((candidate): candidate is ChartSpec => 'chart_id' in candidate)
        .sort((a, b) => a.chart_id.localeCompare(b.chart_id)),
      unavailable: candidates
        .filter((candidate): candidate is ChartUnavailable => !('chart_id' in candidate))
        .sort((a, b) => a.intent.localeCompare(b.intent) || a.reason.localeCompare(b.reason)),
    });
    validateVisualEvidence(payload, [
      inputs.calculation,
      ...(inputs.comparison ? [inputs.comparison] : []),
    ]);
    return payload;
  }
}

export function chartPayloadFingerprint(payload: VisualEvidencePayload): string {
  return canonical(payload);
}

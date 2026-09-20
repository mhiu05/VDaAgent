import Decimal from 'decimal.js';
import {
  DateSchema,
  SEMANTIC_VERSION,
  type AbstentionReason,
  type CalculationPayload,
  type ComparisonItem,
  type Metric,
  type MetricKey,
  type Scope,
  type UnitSnapshot,
} from '@vda/contracts';
import { getMetricDefinition, metricRegistry, type DimensionKey } from './registry';

export * from './registry';

const Money = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
const PERIODS = [7, 30, 90] as const;
const DIMENSIONS: DimensionKey[] = ['zone', 'unit_type', 'bedrooms', 'status'];

export const semanticPack = Object.freeze({
  id: SEMANTIC_VERSION,
  provisional: true,
  rounding: 'decimal-half-up-6dp',
  default_slow_moving_threshold_days: 90,
  peer_rule:
    'Same organization/project/zone/unit_type/bedrooms/currency; area +/-15% inclusive; exclude target; at least 3 valid peers.',
  metrics: Object.fromEntries(
    Object.keys(metricRegistry).map((key) => [
      key,
      `MVP-MET-${key.toUpperCase().replaceAll('_', '-')}-v2`,
    ]),
  ) as Record<MetricKey, string>,
});

export const notableChangeRules = Object.freeze({
  version: 'notable-change-v0.2',
  inventory_relative_pct: new Money(10),
  rate_percentage_points: new Money(5),
  price_relative_pct: new Money(10),
  material_relative_pct: new Money(20),
  material_rate_percentage_points: new Money(10),
});

export const insightPriorityRules = Object.freeze({
  material_change: 100,
  watch_change: 70,
  current_slow_moving_rate: 50,
  current_missing_age_rate: 40,
  current_available_rate: 30,
  max_candidates: 5,
});

export function dayNumber(date: string): number {
  DateSchema.parse(date);
  return Date.parse(`${date}T00:00:00.000Z`) / 86_400_000;
}

export function dateMinusDays(date: string, days: number): string {
  return new Date((dayNumber(date) - days) * 86_400_000).toISOString().slice(0, 10);
}

export function selectLatest(
  rows: UnitSnapshot[],
  orgId: string,
  asOf: string,
  scope?: Scope,
): UnitSnapshot[] {
  DateSchema.parse(asOf);
  const latest = new Map<string, UnitSnapshot>();
  const identities = new Set<string>();
  for (const row of rows) {
    if (row.org_id !== orgId) throw new Error('CROSS_TENANT_SNAPSHOT');
    const identity = `${row.unit_external_id}:${row.snapshot_date}`;
    if (identities.has(identity)) throw new Error('DUPLICATE_SNAPSHOT');
    identities.add(identity);
    if (row.snapshot_date > asOf) continue;
    const current = latest.get(row.unit_external_id);
    if (!current || row.snapshot_date > current.snapshot_date)
      latest.set(row.unit_external_id, row);
  }
  return [...latest.values()]
    .filter(
      (row) =>
        !scope ||
        (row.project_external_id === scope.project_external_id &&
          (!scope.zone_external_id || row.zone_external_id === scope.zone_external_id)),
    )
    .sort((a, b) => a.unit_external_id.localeCompare(b.unit_external_id));
}

function positive(value: string | null): Decimal | null {
  if (value === null) return null;
  const parsed = new Money(value);
  return parsed.gt(0) ? parsed : null;
}

function pricePerArea(row: UnitSnapshot): Decimal | null {
  const price = positive(row.list_price);
  const area = positive(row.area_sqm);
  return price && area ? price.div(area) : null;
}

function percentile(values: Decimal[], p: number): Decimal | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const index = new Money(sorted.length - 1).mul(p);
  const lower = index.floor().toNumber();
  const upper = index.ceil().toNumber();
  return lower === upper
    ? sorted[lower]
    : sorted[lower].plus(sorted[upper].minus(sorted[lower]).mul(index.minus(lower)));
}

const percent = (numerator: number, denominator: number) =>
  denominator ? new Money(numerator).div(denominator).mul(100).toFixed(6) : null;

function latestDate(rows: UnitSnapshot[]): string | null {
  return rows.length
    ? rows.reduce(
        (latest, row) => (row.snapshot_date > latest ? row.snapshot_date : latest),
        rows[0].snapshot_date,
      )
    : null;
}

function result(
  key: MetricKey,
  value: number | string | null,
  reason: AbstentionReason | null = null,
  currency: string | null = null,
): Metric {
  const definition = getMetricDefinition(key);
  return {
    metric_id: semanticPack.metrics[key],
    key,
    label: definition.label,
    description: definition.description,
    value,
    unit: definition.unit,
    currency,
    status: value === null ? 'unavailable' : 'available',
    abstention_reason: value === null ? (reason ?? 'MISSING_REQUIRED_FIELD') : null,
  };
}

type Summary = Pick<CalculationPayload, 'metrics' | 'units' | 'age_buckets'>;

function summarize(rows: UnitSnapshot[], asOf: string, threshold: number): Summary {
  const cutoff = dayNumber(asOf);
  const seen = new Set<string>();
  let available = 0;
  let slow = 0;
  let unknownAge = 0;
  let missingPrice = 0;
  let missingArea = 0;
  let unusable = 0;
  const sales = new Map<number, number>(PERIODS.map((period) => [period, 0]));
  const ages: Decimal[] = [];
  const prices: Decimal[] = [];
  const pricesPerArea: Decimal[] = [];
  const currencies = new Set<string>();
  const ageBuckets: CalculationPayload['age_buckets'] = [
    { bucket: '0-30', value: 0 },
    { bucket: '31-60', value: 0 },
    { bucket: '61-90', value: 0 },
    { bucket: '91-180', value: 0 },
    { bucket: '>180', value: 0 },
    { bucket: 'unknown', value: 0 },
  ];
  const units = rows.map((row) => {
    if (seen.has(row.unit_external_id)) throw new Error('LATEST_SNAPSHOTS_REQUIRED');
    seen.add(row.unit_external_id);
    if (row.snapshot_date > asOf) throw new Error('FUTURE_SNAPSHOT');
    const isAvailable = row.status === 'available';
    const age =
      isAvailable && row.available_since !== null ? cutoff - dayNumber(row.available_since) : null;
    if (age !== null && age < 0) throw new Error('FUTURE_AVAILABLE_DATE');
    const price = positive(row.list_price);
    const area = positive(row.area_sqm);
    if (!price) missingPrice++;
    if (!area) missingArea++;
    if (!price || !area || (isAvailable && age === null)) unusable++;
    if (isAvailable) {
      available++;
      currencies.add(row.currency);
      if (price) prices.push(price);
      const unitPricePerArea = pricePerArea(row);
      if (unitPricePerArea) pricesPerArea.push(unitPricePerArea);
      if (age === null) {
        unknownAge++;
        ageBuckets[5].value++;
      } else {
        ages.push(new Money(age));
        if (age <= 30) ageBuckets[0].value++;
        else if (age <= 60) ageBuckets[1].value++;
        else if (age <= 90) ageBuckets[2].value++;
        else if (age <= 180) ageBuckets[3].value++;
        else ageBuckets[4].value++;
        if (age >= threshold) slow++;
      }
    }
    if (row.sold_at !== null) {
      const soldDate = dayNumber(row.sold_at);
      for (const period of PERIODS)
        if (soldDate >= cutoff - (period - 1) && soldDate <= cutoff)
          sales.set(period, sales.get(period)! + 1);
    }
    const unitPricePerArea = pricePerArea(row);
    return {
      unit_external_id: row.unit_external_id,
      unit_code: row.unit_code,
      project_external_id: row.project_external_id,
      zone_external_id: row.zone_external_id,
      unit_type: row.unit_type,
      currency: row.currency,
      status: row.status,
      area_sqm: row.area_sqm,
      list_price: row.list_price,
      price_per_sqm: unitPricePerArea?.toFixed(6) ?? null,
      age_days: age,
      slow_moving: isAvailable ? (age === null ? null : age >= threshold) : false,
      snapshot_id: row.snapshot_id,
      import_id: row.import_id,
    };
  });
  const absent: AbstentionReason = 'NO_SNAPSHOT';
  const noRows = rows.length === 0;
  const comparableCurrency = currencies.size <= 1;
  const metricCurrency = comparableCurrency && currencies.size === 1 ? [...currencies][0] : null;
  const priceReason: AbstentionReason = comparableCurrency
    ? noRows
      ? absent
      : 'INSUFFICIENT_SAMPLE_SIZE'
    : 'INCOMPARABLE_CURRENCY';
  const unknownAgeRate = noRows ? null : percent(unknownAge, available);
  const medianAge = percentile(ages, 0.5);
  const p75Age = percentile(ages, 0.75);
  const medianPrice = comparableCurrency ? percentile(prices, 0.5) : null;
  const p25 = comparableCurrency ? percentile(pricesPerArea, 0.25) : null;
  const medianPpa = comparableCurrency ? percentile(pricesPerArea, 0.5) : null;
  const p75 = comparableCurrency ? percentile(pricesPerArea, 0.75) : null;
  return {
    metrics: [
      result('total_inventory', noRows ? null : rows.length, absent),
      result('available_inventory', noRows ? null : available, absent),
      result(
        'available_inventory_rate',
        noRows ? null : percent(available, rows.length),
        noRows ? absent : 'ZERO_DENOMINATOR',
      ),
      result('sold_units_7d', noRows ? null : sales.get(7)!, absent),
      result('sold_units_30d', noRows ? null : sales.get(30)!, absent),
      result('sold_units_90d', noRows ? null : sales.get(90)!, absent),
      result(
        'median_inventory_age_days',
        medianAge?.toNumber() ?? null,
        noRows ? absent : 'INSUFFICIENT_SAMPLE_SIZE',
      ),
      result(
        'p75_inventory_age_days',
        p75Age?.toNumber() ?? null,
        noRows ? absent : 'INSUFFICIENT_SAMPLE_SIZE',
      ),
      result('slow_moving_units', noRows ? null : slow, absent),
      result(
        'slow_moving_rate',
        noRows ? null : percent(slow, available - unknownAge),
        noRows ? absent : 'ZERO_DENOMINATOR',
      ),
      result('unknown_inventory_age', noRows ? null : unknownAge, absent),
      result('unknown_inventory_age_rate', unknownAgeRate, noRows ? absent : 'ZERO_DENOMINATOR'),
      result('median_price', medianPrice?.toFixed(6) ?? null, priceReason, metricCurrency),
      result('median_price_per_area', medianPpa?.toFixed(6) ?? null, priceReason, metricCurrency),
      result('p25_price_per_area', p25?.toFixed(6) ?? null, priceReason, metricCurrency),
      result('p75_price_per_area', p75?.toFixed(6) ?? null, priceReason, metricCurrency),
      result(
        'price_per_area_iqr',
        p25 && p75 ? p75.minus(p25).toFixed(6) : null,
        priceReason,
        metricCurrency,
      ),
      result('missing_inventory_age_rate', unknownAgeRate, noRows ? absent : 'ZERO_DENOMINATOR'),
      result('missing_price_rate', noRows ? null : percent(missingPrice, rows.length), absent),
      result('missing_area_rate', noRows ? null : percent(missingArea, rows.length), absent),
      result('records_with_invalid_or_unusable_values', noRows ? null : unusable, absent),
    ],
    units,
    age_buckets: ageBuckets,
  };
}

const valueOf = (metrics: Metric[], key: MetricKey) =>
  metrics.find((item) => item.key === key)?.value ?? null;
const metricOf = (metrics: Metric[], key: MetricKey) =>
  metrics.find((item) => item.key === key) ?? null;
const decimalOf = (value: number | string) => new Money(value);

function agingLimitations(metrics: Metric[]): string[] {
  const missing = metricOf(metrics, 'unknown_inventory_age');
  const rate = metricOf(metrics, 'unknown_inventory_age_rate');
  if (!missing || !rate || missing.value === null || rate.value === null) return [];
  if (decimalOf(missing.value).eq(0)) return [];
  return [
    `Aging metrics exclude ${missing.value} available unit(s) with unknown age (${rate.value}% of available inventory).`,
  ];
}

function dimensionValue(row: UnitSnapshot, dimension: DimensionKey): string {
  if (dimension === 'project') return row.project_external_id;
  if (dimension === 'zone') return row.zone_external_id;
  if (dimension === 'unit_type') return row.unit_type;
  if (dimension === 'bedrooms') return row.bedrooms === null ? 'unknown' : String(row.bedrooms);
  return row.status;
}

function buildBreakdowns(
  rows: UnitSnapshot[],
  asOf: string,
  scope: Scope,
  threshold: number,
): CalculationPayload['breakdowns'] {
  const keys: MetricKey[] = [
    'total_inventory',
    'available_inventory',
    'available_inventory_rate',
    'slow_moving_rate',
    'median_inventory_age_days',
    'median_price_per_area',
  ];
  return DIMENSIONS.flatMap((dimension) => {
    const groups = new Map<string, UnitSnapshot[]>();
    for (const row of rows) {
      const key = dimensionValue(row, dimension);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const summaries = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => ({ key, summary: summarize(group, asOf, threshold) }));
    return keys.map((metricKey) => ({
      metric_key: metricKey,
      scope,
      dimension,
      data_as_of: asOf,
      snapshot_date: latestDate(rows),
      snapshot_refs: rows.map((row) => row.snapshot_id).sort(),
      source_refs: [...new Set(rows.map((row) => row.import_id))].sort(),
      filter: {
        project_external_id: scope.project_external_id,
        zone_external_id: scope.zone_external_id,
      },
      semantic_version: SEMANTIC_VERSION,
      limitations:
        metricKey === 'slow_moving_rate' || metricKey === 'median_inventory_age_days'
          ? summaries.flatMap(({ summary }) => agingLimitations(summary.metrics))
          : [],
      items: summaries.map(({ key, summary }) => ({
        key,
        label: key === 'unknown' ? 'Unknown' : key,
        value: valueOf(summary.metrics, metricKey),
        currency: metricOf(summary.metrics, metricKey)?.currency ?? null,
        abstention_reason: metricOf(summary.metrics, metricKey)?.abstention_reason ?? null,
      })),
    }));
  });
}

function buildPeriodComparisons(
  allRows: UnitSnapshot[],
  currentRows: UnitSnapshot[],
  currentMetrics: Metric[],
  orgId: string,
  scope: Scope,
  asOf: string,
  threshold: number,
): CalculationPayload['period_comparisons'] {
  const keys: MetricKey[] = [
    'available_inventory',
    'available_inventory_rate',
    'slow_moving_rate',
    'median_inventory_age_days',
    'median_price_per_area',
    'missing_inventory_age_rate',
  ];
  return PERIODS.flatMap((period) => {
    const target = dateMinusDays(asOf, period);
    const priorRows = selectLatest(allRows, orgId, target, scope);
    const prior = summarize(priorRows, target, threshold);
    return keys.map((metricKey) => {
      const currentMetric = metricOf(currentMetrics, metricKey);
      const comparisonMetric = metricOf(prior.metrics, metricKey);
      const currentValue = currentMetric?.value ?? null;
      const comparisonValue = comparisonMetric?.value ?? null;
      const unit = getMetricDefinition(metricKey).unit;
      let absoluteDelta: number | string | null = null;
      let relativeDelta: string | null = null;
      let pointDelta: string | null = null;
      let abstention: AbstentionReason | null = null;
      let relativeAbstention: AbstentionReason | null = null;
      if (!priorRows.length) abstention = 'INSUFFICIENT_HISTORY';
      else if (currentValue === null || comparisonValue === null)
        abstention =
          currentMetric?.abstention_reason ??
          comparisonMetric?.abstention_reason ??
          'MISSING_REQUIRED_FIELD';
      else if (
        (unit === 'currency' || unit === 'currency_per_sqm') &&
        currentMetric?.currency !== comparisonMetric?.currency
      )
        abstention = 'INCOMPARABLE_CURRENCY';
      else {
        const previous = decimalOf(comparisonValue);
        const delta = decimalOf(currentValue).minus(previous);
        absoluteDelta = unit === 'count' || unit === 'days' ? delta.toNumber() : delta.toFixed(6);
        if (unit === 'percent') pointDelta = delta.toFixed(6);
        if (previous.eq(0)) relativeAbstention = 'ZERO_DENOMINATOR';
        else relativeDelta = delta.div(previous).mul(100).toFixed(6);
      }
      return {
        metric_key: metricKey,
        period_days: period,
        current_as_of: asOf,
        current_snapshot_date: latestDate(currentRows),
        comparison_target_date: target,
        comparison_snapshot_date: latestDate(priorRows),
        current_value: currentValue,
        comparison_value: comparisonValue,
        current_currency: currentMetric?.currency ?? null,
        comparison_currency: comparisonMetric?.currency ?? null,
        absolute_delta: absoluteDelta,
        relative_delta_pct: relativeDelta,
        percentage_point_delta: pointDelta,
        abstention_reason: abstention,
        relative_delta_abstention_reason: relativeAbstention,
        snapshot_refs: [
          ...new Set([...currentRows, ...priorRows].map((row) => row.snapshot_id)),
        ].sort(),
      };
    });
  });
}

function buildSegmentComparisons(
  breakdowns: CalculationPayload['breakdowns'],
): CalculationPayload['segment_comparisons'] {
  return breakdowns.flatMap((breakdown) => {
    if (breakdown.items.length < 2) return [];
    const reference = breakdown.items[0];
    return breakdown.items.slice(1).map((item) => {
      let absoluteDelta: number | string | null = null;
      let relativeDelta: string | null = null;
      let pointDelta: string | null = null;
      let abstention: AbstentionReason | null = null;
      let relativeAbstention: AbstentionReason | null = null;
      if (item.value === null || reference.value === null)
        abstention =
          item.abstention_reason ?? reference.abstention_reason ?? 'MISSING_REQUIRED_FIELD';
      else if (item.currency !== reference.currency) abstention = 'INCOMPARABLE_CURRENCY';
      else {
        const previous = decimalOf(reference.value);
        const delta = decimalOf(item.value).minus(previous);
        absoluteDelta =
          typeof item.value === 'number' && typeof reference.value === 'number'
            ? delta.toNumber()
            : delta.toFixed(6);
        if (getMetricDefinition(breakdown.metric_key).unit === 'percent')
          pointDelta = delta.toFixed(6);
        if (previous.eq(0)) relativeAbstention = 'ZERO_DENOMINATOR';
        else relativeDelta = delta.div(previous).mul(100).toFixed(6);
      }
      return {
        dimension: breakdown.dimension as 'zone' | 'unit_type' | 'bedrooms' | 'status',
        metric_key: breakdown.metric_key,
        segment_key: item.key,
        segment_value: item.value,
        segment_currency: item.currency,
        reference_key: reference.key,
        reference_value: reference.value,
        reference_currency: reference.currency,
        absolute_delta: absoluteDelta,
        relative_delta_pct: relativeDelta,
        percentage_point_delta: pointDelta,
        abstention_reason: abstention,
        relative_delta_abstention_reason: relativeAbstention,
      };
    });
  });
}

function detectChanges(
  comparisons: CalculationPayload['period_comparisons'],
  scope: Scope,
): CalculationPayload['notable_changes'] {
  return comparisons
    .flatMap((comparison, index) => {
      if (
        comparison.abstention_reason !== null ||
        comparison.current_value === null ||
        comparison.comparison_value === null ||
        comparison.absolute_delta === null
      )
        return [];
      const definition = getMetricDefinition(comparison.metric_key);
      const relative = comparison.relative_delta_pct
        ? decimalOf(comparison.relative_delta_pct).abs()
        : null;
      const points = comparison.percentage_point_delta
        ? decimalOf(comparison.percentage_point_delta).abs()
        : null;
      const price = comparison.metric_key === 'median_price_per_area';
      const eligible =
        (definition.unit === 'percent' && points?.gte(notableChangeRules.rate_percentage_points)) ||
        (price && relative?.gte(notableChangeRules.price_relative_pct)) ||
        (comparison.metric_key === 'available_inventory' &&
          relative?.gte(notableChangeRules.inventory_relative_pct));
      if (!eligible) return [];
      const threshold =
        definition.unit === 'percent'
          ? `${notableChangeRules.rate_percentage_points.toString()} percentage points`
          : `${price ? notableChangeRules.price_relative_pct.toString() : notableChangeRules.inventory_relative_pct.toString()}% relative`;
      return [
        {
          rule_id: `${notableChangeRules.version}:${comparison.metric_key}:${comparison.period_days}d`,
          metric_key: comparison.metric_key,
          current_value: comparison.current_value,
          comparison_value: comparison.comparison_value,
          delta: comparison.absolute_delta,
          scope,
          threshold,
          evidence_paths: [`payload.period_comparisons[${index}].current_value`],
          reason: `${definition.label} crossed the configured ${comparison.period_days}-day materiality threshold.`,
          severity:
            relative?.gte(notableChangeRules.material_relative_pct) ||
            points?.gte(notableChangeRules.material_rate_percentage_points)
              ? ('material' as const)
              : ('watch' as const),
        },
      ];
    })
    .sort((a, b) => a.rule_id.localeCompare(b.rule_id));
}

function buildCandidates(
  changes: CalculationPayload['notable_changes'],
  metrics: Metric[],
  qualityLimitations: string[],
): CalculationPayload['insight_candidates'] {
  const output: CalculationPayload['insight_candidates'] = changes.map((change, index) => ({
    candidate_id: `notable:${change.rule_id}`,
    observation: change.reason,
    metric_key: change.metric_key,
    evidence_paths: change.evidence_paths,
    context: `Current ${change.current_value}; comparison ${change.comparison_value}.`,
    interpretation: 'The deterministic threshold was crossed; no cause is asserted.',
    limitations:
      change.metric_key.includes('age') || change.metric_key === 'slow_moving_rate'
        ? qualityLimitations
        : [],
    priority:
      (change.severity === 'material'
        ? insightPriorityRules.material_change
        : insightPriorityRules.watch_change) - index,
  }));
  for (const key of [
    'slow_moving_rate',
    'missing_inventory_age_rate',
    'available_inventory_rate',
  ] as const) {
    const found = metrics.find((item) => item.key === key);
    if (!found || found.value === null || output.some((item) => item.metric_key === key)) continue;
    output.push({
      candidate_id: `current:${key}`,
      observation: `${found.label} is ${found.value} ${found.unit}.`,
      metric_key: key,
      evidence_paths: [`payload.metrics[${metrics.indexOf(found)}].value`],
      context: 'Current point-in-time result.',
      interpretation: 'Descriptive observation only.',
      limitations:
        key === 'slow_moving_rate' || key === 'missing_inventory_age_rate'
          ? qualityLimitations
          : [],
      priority:
        key === 'slow_moving_rate'
          ? insightPriorityRules.current_slow_moving_rate
          : key === 'missing_inventory_age_rate'
            ? insightPriorityRules.current_missing_age_rate
            : insightPriorityRules.current_available_rate,
    });
  }
  return output
    .sort((a, b) => b.priority - a.priority || a.candidate_id.localeCompare(b.candidate_id))
    .filter(
      (item, index, all) =>
        all.findIndex((candidate) => candidate.metric_key === item.metric_key) === index,
    )
    .slice(0, insightPriorityRules.max_candidates);
}

export function analyze(
  rows: UnitSnapshot[],
  orgId: string,
  scope: Scope,
  asOf: string,
  threshold = 90,
): CalculationPayload {
  if (!Number.isInteger(threshold) || threshold < 1) throw new Error('INVALID_THRESHOLD');
  const currentRows = selectLatest(rows, orgId, asOf, scope);
  const summary = summarize(currentRows, asOf, threshold);
  const scopedHistory = rows.filter(
    (row) => row.snapshot_date <= asOf && row.project_external_id === scope.project_external_id,
  );
  const population = new Set(currentRows.map((row) => row.unit_external_id));
  const snapshotDate = latestDate(currentRows);
  const covered = new Set(
    scopedHistory
      .filter(
        (row) =>
          row.snapshot_date === snapshotDate &&
          (!scope.zone_external_id || row.zone_external_id === scope.zone_external_id),
      )
      .map((row) => row.unit_external_id),
  ).size;
  summary.metrics.push(
    result(
      'snapshot_coverage',
      population.size ? percent(covered, population.size) : null,
      population.size ? null : 'NO_SNAPSHOT',
    ),
  );
  const periodComparisons = buildPeriodComparisons(
    scopedHistory,
    currentRows,
    summary.metrics,
    orgId,
    scope,
    asOf,
    threshold,
  );
  for (const period of PERIODS) {
    const comparison = periodComparisons.find(
      (item) => item.period_days === period && item.metric_key === 'available_inventory',
    )!;
    summary.metrics.splice(
      6 + PERIODS.indexOf(period),
      0,
      result(
        `inventory_change_${period}d` as MetricKey,
        comparison.absolute_delta,
        comparison.abstention_reason,
      ),
    );
  }
  const breakdowns = buildBreakdowns(currentRows, asOf, scope, threshold);
  const segmentComparisons = buildSegmentComparisons(breakdowns);
  const notableChanges = detectChanges(periodComparisons, scope);
  const qualityLimitations = agingLimitations(summary.metrics);
  return {
    metrics: summary.metrics,
    units: summary.units,
    slow_moving_threshold_days: threshold,
    current_snapshot_date: snapshotDate,
    quality_limitations: qualityLimitations,
    age_buckets: summary.age_buckets,
    breakdowns,
    period_comparisons: periodComparisons,
    segment_comparisons: segmentComparisons,
    notable_changes: notableChanges,
    insight_candidates: buildCandidates(notableChanges, summary.metrics, qualityLimitations),
  };
}

export function calculate(rows: UnitSnapshot[], asOf: string, threshold = 90): CalculationPayload {
  const orgId = rows[0]?.org_id ?? '00000000-0000-0000-0000-000000000000';
  const project = rows[0]?.project_external_id ?? 'unavailable';
  return analyze(
    rows,
    orgId,
    { project_external_id: project, zone_external_id: null },
    asOf,
    threshold,
  );
}

export function compare(rows: UnitSnapshot[]): ComparisonItem[] {
  return rows.map((target) => {
    const targetPrice = pricePerArea(target);
    const targetArea = positive(target.area_sqm);
    const peers = !targetArea
      ? []
      : rows
          .filter((peer) => {
            if (
              peer.unit_external_id === target.unit_external_id ||
              peer.org_id !== target.org_id ||
              peer.project_external_id !== target.project_external_id ||
              peer.zone_external_id !== target.zone_external_id ||
              peer.unit_type !== target.unit_type ||
              peer.bedrooms !== target.bedrooms ||
              peer.currency !== target.currency ||
              !positive(peer.area_sqm) ||
              !pricePerArea(peer)
            )
              return false;
            const area = positive(peer.area_sqm)!;
            return area.gte(targetArea.mul('0.85')) && area.lte(targetArea.mul('1.15'));
          })
          .sort((a, b) => a.unit_external_id.localeCompare(b.unit_external_id));
    let reason: AbstentionReason | null = targetPrice
      ? peers.length < 3
        ? 'INSUFFICIENT_PEERS'
        : null
      : 'MISSING_REQUIRED_FIELD';
    const median = percentile(
      peers.map((peer) => pricePerArea(peer)!),
      0.5,
    );
    if (!reason && (!median || !median.gt(0))) reason = 'ZERO_DENOMINATOR';
    return {
      unit_external_id: target.unit_external_id,
      currency: target.currency,
      peer_ids: peers.map((peer) => peer.unit_external_id),
      peer_snapshot_ids: peers.map((peer) => peer.snapshot_id),
      cohort_rule: semanticPack.peer_rule,
      peer_count: peers.length,
      median_price_per_sqm: reason || !median ? null : median.toFixed(6),
      price_gap_pct:
        reason || !median || !targetPrice
          ? null
          : targetPrice.minus(median).div(median).mul(100).toFixed(6),
      abstention_reason: reason,
    };
  });
}

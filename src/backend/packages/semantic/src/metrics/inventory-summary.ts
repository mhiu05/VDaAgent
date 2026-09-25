import { semanticPack } from '../pack';
import type { AbstentionReason, Metric, MetricKey } from '@vda/contracts/analysis/metrics';
import { getMetricDefinition } from './registry';
import type { CalculationPayload } from '@vda/contracts/analysis/calculation';
import { dayNumber } from '../core/date';
import { Money, percent, percentile, positive, pricePerArea } from '../core/decimal';
import type { UnitSnapshot } from '@vda/contracts/imports/inventory';
import Decimal from 'decimal.js';

export const PERIODS = [7, 30, 90] as const;

export function result(
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

export function summarize(rows: UnitSnapshot[], asOf: string, threshold: number): Summary {
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

export const valueOf = (metrics: Metric[], key: MetricKey) =>
  metrics.find((item) => item.key === key)?.value ?? null;
export const metricOf = (metrics: Metric[], key: MetricKey) =>
  metrics.find((item) => item.key === key) ?? null;

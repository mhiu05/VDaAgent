import { describe, expect, it } from 'vitest';
import { analyze, buildDecisionBrief, compare, metricRegistry, selectLatest } from '@vda/semantic';
import { localDate, nextScheduledAt } from '@vda/domain';
import { ORG, oracleRows, row } from '../../fixtures/inventory';

const scope = { project_external_id: 'P-ALPHA', zone_external_id: null };
const calculationArtifactId = '50000000-0000-4000-8000-000000000001';

describe('inventory numeric truth', () => {
  it('abstains when no snapshot exists and counts only the latest row per unit', () => {
    expect(
      analyze([], ORG, scope, '2026-09-19').metrics.every((metric) => metric.value === null),
    ).toBe(true);
    const selected = selectLatest(oracleRows(), ORG, '2026-09-19');
    const metrics = Object.fromEntries(
      analyze(selected, ORG, scope, '2026-09-19').metrics.map((metric) => [
        metric.key,
        metric.value,
      ]),
    );
    expect(metrics).toMatchObject({
      total_inventory: 8,
      available_inventory: 2,
      sold_units_30d: 2,
      slow_moving_units: 1,
      unknown_inventory_age: 1,
    });
  });

  it('retains null denominators and exact decimal division', () => {
    const result = analyze(
      [
        row({ unit_external_id: 'zero', area_sqm: '0' }),
        row({ unit_external_id: 'missing', list_price: null }),
        row({ unit_external_id: 'decimal', list_price: '100.01', area_sqm: '3' }),
      ],
      ORG,
      scope,
      '2026-09-19',
    );
    expect(
      Object.fromEntries(result.units.map((unit) => [unit.unit_external_id, unit.price_per_sqm])),
    ).toEqual({ zero: null, missing: null, decimal: '33.336667' });
  });

  it('applies scope after latest selection and fences tenant mixing', () => {
    const earlier = row({ unit_external_id: 'moved', snapshot_date: '2026-09-01' });
    const later = row({ unit_external_id: 'moved', zone_external_id: 'Z-SOUTH' });
    expect(
      selectLatest([earlier, later], ORG, '2026-09-19', {
        project_external_id: 'P-ALPHA',
        zone_external_id: 'Z-NORTH',
      }),
    ).toHaveLength(0);
    expect(() => selectLatest([earlier, earlier], ORG, '2026-09-19')).toThrow('DUPLICATE');
    expect(() =>
      selectLatest([row({ org_id: '10000000-0000-4000-8000-000000000002' })], ORG, '2026-09-19'),
    ).toThrow('CROSS_TENANT');
  });

  it('uses exact peer boundaries and abstains below the cohort minimum', () => {
    const target = row({ unit_external_id: 'target', list_price: '1000' });
    const peers = [
      row({ area_sqm: '85', list_price: '850' }),
      row({ area_sqm: '100', list_price: '2000' }),
      row({ area_sqm: '115', list_price: '3450' }),
    ];
    const outside = [
      row({ area_sqm: '84.99' }),
      row({ area_sqm: '115.01' }),
      row({ currency: 'USD' }),
      row({ bedrooms: 2 }),
    ];
    const comparison = compare([target, ...peers, ...outside])[0];
    expect(comparison).toMatchObject({
      peer_count: 3,
      median_price_per_sqm: '20.000000',
      price_gap_pct: '-50.000000',
    });
    expect(compare([target, ...peers.slice(0, 2)])[0]?.median_price_per_sqm).toBeNull();
  });

  it('keeps as-of dates and local schedules stable across timezones', () => {
    expect(localDate(new Date('2026-09-18T18:00:00Z'), 'Asia/Bangkok')).toBe('2026-09-19');
    expect(
      nextScheduledAt(
        { timezone: 'America/New_York', local_time: '02:30' },
        new Date('2026-03-08T06:59:00Z'),
      ),
    ).toBe('2026-03-09T06:30:00.000Z');
    expect(
      analyze(
        [],
        ORG,
        { project_external_id: 'P-ALPHA', zone_external_id: null },
        '2026-09-19',
      ).metrics.every((metric) => metric.value === null),
    ).toBe(true);
  });

  it('registers every emitted metric under the pinned semantic version', () => {
    const calculation = analyze([row()], ORG, scope, '2026-09-19');
    expect(calculation.metrics.map((metric) => metric.key).sort()).toEqual(
      Object.keys(metricRegistry).sort(),
    );
    expect(
      Object.values(metricRegistry).every(
        (definition) => definition.semanticVersion === 'mvp-inventory-v0.2',
      ),
    ).toBe(true);
  });

  it('keeps exact age buckets and the inclusive slow-moving threshold', () => {
    const availableDates = [
      '2026-08-21',
      '2026-08-20',
      '2026-07-22',
      '2026-07-21',
      '2026-06-22',
      '2026-06-21',
      '2026-03-24',
      '2026-03-23',
    ];
    const result = analyze(
      availableDates.map((available_since, index) =>
        row({
          unit_external_id: `age-${index}`,
          snapshot_date: '2026-09-20',
          available_since,
        }),
      ),
      ORG,
      scope,
      '2026-09-20',
    );
    expect(result.age_buckets).toEqual([
      { bucket: '0-30', value: 1 },
      { bucket: '31-60', value: 2 },
      { bucket: '61-90', value: 2 },
      { bucket: '91-180', value: 2 },
      { bucket: '>180', value: 1 },
      { bucket: 'unknown', value: 0 },
    ]);
    expect(result.metrics.find((metric) => metric.key === 'slow_moving_units')?.value).toBe(4);
  });

  it('computes decimal median and quartiles without floating money math', () => {
    const result = analyze(
      ['10', '20', '30', '40'].map((list_price, index) =>
        row({
          unit_external_id: `price-${index}`,
          list_price,
          area_sqm: '1',
        }),
      ),
      ORG,
      scope,
      '2026-09-19',
    );
    expect(
      Object.fromEntries(result.metrics.map((metric) => [metric.key, metric.value])),
    ).toMatchObject({
      median_price_per_area: '25.000000',
      p25_price_per_area: '17.500000',
      p75_price_per_area: '32.500000',
      price_per_area_iqr: '15.000000',
    });
  });

  it('keeps absolute and percentage-point deltas when a relative baseline is zero', () => {
    const result = analyze(
      [
        row({ snapshot_date: '2026-09-13', status: 'sold', sold_at: '2026-09-13' }),
        row({ snapshot_date: '2026-09-20', status: 'available', sold_at: null }),
      ],
      ORG,
      scope,
      '2026-09-20',
    );
    expect(
      result.period_comparisons.find(
        (comparison) =>
          comparison.period_days === 7 && comparison.metric_key === 'available_inventory',
      ),
    ).toMatchObject({
      comparison_value: 0,
      current_value: 1,
      absolute_delta: 1,
      relative_delta_pct: null,
      abstention_reason: null,
      relative_delta_abstention_reason: 'ZERO_DENOMINATOR',
    });
    expect(result.metrics.find((metric) => metric.key === 'inventory_change_7d')).toMatchObject({
      value: 1,
      status: 'available',
    });
  });

  it('rejects monetary comparisons across currencies', () => {
    const result = analyze(
      [
        row({
          unit_external_id: 'currency-unit',
          snapshot_date: '2026-09-13',
          currency: 'USD',
          list_price: '100',
        }),
        row({
          unit_external_id: 'currency-unit',
          snapshot_date: '2026-09-20',
          currency: 'VND',
          list_price: '2500000',
        }),
      ],
      ORG,
      scope,
      '2026-09-20',
    );
    expect(
      result.period_comparisons.find(
        (comparison) =>
          comparison.period_days === 7 && comparison.metric_key === 'median_price_per_area',
      ),
    ).toMatchObject({
      current_currency: 'VND',
      comparison_currency: 'USD',
      absolute_delta: null,
      relative_delta_pct: null,
      abstention_reason: 'INCOMPARABLE_CURRENCY',
    });
    expect(
      buildDecisionBrief(result, calculationArtifactId, scope, '2026-09-20').material_changes.some(
        (signal) => signal.metric_key === 'median_price_per_area',
      ),
    ).toBe(false);
  });

  it('propagates unknown inventory age to caveats and candidate limitations', () => {
    const result = analyze(
      [
        row({ unit_external_id: 'known', available_since: '2026-06-01' }),
        row({ unit_external_id: 'unknown', available_since: null }),
      ],
      ORG,
      scope,
      '2026-09-19',
    );
    expect(result.quality_limitations).toEqual([
      'Chỉ số tuổi tồn kho loại trừ 1 căn còn hàng chưa rõ tuổi (50.000000% tổng số căn còn hàng).',
    ]);
    expect(
      result.breakdowns.find(
        (breakdown) =>
          breakdown.dimension === 'zone' && breakdown.metric_key === 'slow_moving_rate',
      )?.limitations,
    ).toEqual(result.quality_limitations);
    expect(
      result.insight_candidates.find((candidate) => candidate.metric_key === 'slow_moving_rate')
        ?.limitations,
    ).toEqual(result.quality_limitations);
  });
});

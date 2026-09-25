import { describe, expect, it } from 'vitest';
import {
  analyze,
  buildDecisionBrief,
  calculate,
  compare,
  metricRegistry,
  selectLatest,
} from '@vda/semantic';
import {
  AnalysisRequestSchema,
  ArtifactSchema,
  DateSchema,
  SnapshotRowSchema,
} from '@vda/contracts';
import { localDate, nextScheduledAt } from '@vda/domain';
import { getConfig } from '@vda/config';
import { ORG, oracleRows, row } from '../fixtures/inventory';
describe('provisional numeric oracle', () => {
  it('abstains when no snapshot exists instead of reporting measured zero', () => {
    expect(calculate([], '2026-09-19').metrics.every((m) => m.value === null)).toBe(true);
  });
  it('selects latest per unit before counting status and respects inclusive D-29 cutoff', () => {
    const data = selectLatest(oracleRows(), ORG, '2026-09-19');
    const result = calculate(data, '2026-09-19');
    expect(Object.fromEntries(result.metrics.map((m) => [m.key, m.value]))).toMatchObject({
      total_inventory: 8,
      available_inventory: 2,
      sold_units_30d: 2,
      slow_moving_units: 1,
      unknown_inventory_age: 1,
    });
    expect(result.units.find((u) => u.unit_external_id === 'U1')?.age_days).toBe(90);
    expect(result.units.find((u) => u.unit_external_id === 'U2')?.slow_moving).toBeNull();
  });
  it('retains missing denominators and decimal precision', () => {
    const result = calculate(
      [
        row({ unit_external_id: 'zero', area_sqm: '0' }),
        row({ unit_external_id: 'missing', list_price: null }),
        row({ unit_external_id: 'decimal', list_price: '100.01', area_sqm: '3' }),
      ],
      '2026-09-19',
    );
    expect(
      Object.fromEntries(result.units.map((u) => [u.unit_external_id, u.price_per_sqm])),
    ).toEqual({
      zero: null,
      missing: null,
      decimal: '33.336667',
    });
  });
  it('applies scope after latest selection and rejects tenant mixing/duplicates', () => {
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
  it('uses exact cohort boundaries, median and no widened peers', () => {
    const target = row({ unit_external_id: 'target', list_price: '1000' });
    const peers = [
      row({ area_sqm: '85', list_price: '850' }),
      row({ area_sqm: '100', list_price: '2000' }),
      row({ area_sqm: '115', list_price: '3450' }),
    ];
    const excluded = [
      row({ area_sqm: '84.99' }),
      row({ area_sqm: '115.01' }),
      row({ currency: 'USD' }),
      row({ bedrooms: 2 }),
      row({ zone_external_id: 'other' }),
    ];
    const comparison = compare([target, ...peers, ...excluded])[0];
    expect(comparison.peer_count).toBe(3);
    expect(comparison.median_price_per_sqm).toBe('20.000000');
    expect(comparison.price_gap_pct).toBe('-50.000000');
    expect(comparison.peer_ids).not.toContain('target');
    const abstain = compare([target, ...peers.slice(0, 2)])[0];
    expect(abstain.median_price_per_sqm).toBeNull();
    expect(abstain.abstention_reason).toBeTruthy();
  });
  it('handles local dates and daily DST gap deterministically', () => {
    expect(
      nextScheduledAt(
        { timezone: 'America/New_York', local_time: '01:30' },
        new Date('2026-11-01T05:30:00Z'),
      ),
    ).toBe('2026-11-02T06:30:00.000Z');
    expect(localDate(new Date('2026-09-18T18:00:00Z'), 'Asia/Bangkok')).toBe('2026-09-19');
    expect(
      nextScheduledAt(
        { timezone: 'Asia/Bangkok', local_time: '07:00' },
        new Date('2026-09-18T23:59:00Z'),
      ),
    ).toBe('2026-09-19T00:00:00.000Z');
    expect(
      nextScheduledAt(
        { timezone: 'America/New_York', local_time: '02:30' },
        new Date('2026-03-08T06:59:00Z'),
      ),
    ).toBe('2026-03-09T06:30:00.000Z');
  });
});
describe('shared contracts and configuration', () => {
  it('rejects invalid calendar dates and future availability', () => {
    expect(DateSchema.safeParse('2026-02-30').success).toBe(false);
    const {
      org_id: _org,
      import_id: _import,
      snapshot_id: _snapshot,
      ...input
    } = row({ available_since: '2026-09-20' });
    expect(SnapshotRowSchema.safeParse(input).success).toBe(false);
  });
  it('rejects client role injection and artifacts without provisional metadata', () => {
    expect(
      AnalysisRequestSchema.safeParse({
        org_id: ORG,
        scope: { project_external_id: 'P' },
        data_as_of: '2026-09-19',
        question: 'synthetic fixture',
        role: 'owner',
      }).success,
    ).toBe(false);
    expect(ArtifactSchema.safeParse({ kind: 'report', provisional: false }).success).toBe(false);
  });
  it('keeps legacy narration configured while gating runtime providers behind default-off flags', () => {
    const supabase = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
      SUPABASE_SECRET_KEY: 'secret-test-key',
      SUPABASE_DB_URL: 'postgresql://postgres:password@example.supabase.co:5432/postgres',
    };
    const providers = {
      LLM_PRIMARY_PROVIDER: 'gemini' as const,
      LLM_FALLBACK_PROVIDER: 'openai' as const,
      GEMINI_API_KEY: 'test-gemini-key',
      GEMINI_MODEL: 'gemini-test',
      OPENAI_API_KEY: 'test-openai-key',
      OPENAI_MODEL: 'gpt-test',
    };
    expect(
      getConfig({ ...supabase, ...providers, NODE_ENV: 'development' }).DEVELOPMENT_ROLE_BYPASS,
    ).toBe(true);
    expect(getConfig({ ...supabase, ...providers, NODE_ENV: 'test' }).DEVELOPMENT_ROLE_BYPASS).toBe(
      false,
    );
    const defaults = getConfig({ ...supabase, ...providers, AGENT_WORKFLOW_ENABLED: 'false' });
    expect('AGENT_WORKFLOW_ENABLED' in defaults).toBe(false);
    expect(defaults.GROK_RUNTIME_ENABLED).toBe(true);
    expect(defaults.GROK_WORKSPACE_ENABLED).toBe(true);
    expect(defaults.DURABLE_AGENT_EXECUTION_ENABLED).toBe(true);
    expect(defaults.GROK_SSE_ENABLED).toBe(false);
    expect(defaults.AGENT_LLM_PRIMARY_PROVIDER).toBe('gemini');
    expect(defaults.AGENT_LLM_FALLBACK_PROVIDER).toBe('openai');
    expect(defaults.AGENT_PROVIDER_TIMEOUT_MS).toBe(12_000);
    expect(defaults.AGENT_TURN_TIMEOUT_MS).toBe(45_000);
    expect(defaults.XAI_REQUIRE_ZDR).toBe(false);
    expect(
      getConfig({
        ...supabase,
        ...providers,
        GROK_RUNTIME_ENABLED: 'true',
        AGENT_LLM_PRIMARY_PROVIDER: 'gemini',
        AGENT_LLM_FALLBACK_PROVIDER: 'openai',
      }).GROK_RUNTIME_ENABLED,
    ).toBe(true);
    const xaiRuntime = {
      GROK_RUNTIME_ENABLED: 'true' as const,
      AGENT_LLM_PRIMARY_PROVIDER: 'xai' as const,
      AGENT_LLM_FALLBACK_PROVIDER: 'gemini' as const,
      XAI_API_KEY: 'test-xai-key',
      XAI_MODEL: 'grok-test',
      NODE_ENV: 'production',
    };
    expect(
      getConfig({ ...supabase, ...providers, ...xaiRuntime, XAI_BASE_URL: 'https://api.x.ai/v1' })
        .XAI_BASE_URL,
    ).toBe('https://api.x.ai/v1');
    expect(
      getConfig({
        ...supabase,
        ...providers,
        ...xaiRuntime,
        XAI_BASE_URL: 'https://us.api.x.ai/v1',
      }).XAI_BASE_URL,
    ).toBe('https://us.api.x.ai/v1');
    for (const unsafeBaseUrl of [
      'http://api.x.ai/v1',
      'https://api.x.ai.evil.example/v1',
      'https://api.x.ai:443/v1',
      'https://user@api.x.ai/v1',
      'https://api.x.ai/v1?redirect=evil',
      'https://api.x.ai/other',
    ])
      expect(() =>
        getConfig({ ...supabase, ...providers, ...xaiRuntime, XAI_BASE_URL: unsafeBaseUrl }),
      ).toThrow('XAI_BASE_URL');
    expect(() =>
      getConfig({
        ...supabase,
        ...providers,
        NODE_ENV: 'production',
        DEVELOPMENT_ROLE_BYPASS: 'true',
      }),
    ).toThrow('DEVELOPMENT_ROLE_BYPASS');
    expect(() => getConfig({})).toThrow('NEXT_PUBLIC_SUPABASE_URL');
    expect(() =>
      getConfig({
        ...supabase,
        LLM_PRIMARY_PROVIDER: 'gemini',
        LLM_FALLBACK_PROVIDER: 'openai',
      }),
    ).toThrow('Gemini requires');
    expect(() =>
      getConfig({
        ...supabase,
        LLM_PRIMARY_PROVIDER: 'gemini',
        LLM_FALLBACK_PROVIDER: 'openai',
        GEMINI_API_KEY: 'test-gemini-key',
        GEMINI_MODEL: 'gemini-test',
      }),
    ).toThrow('OpenAI fallback requires');
    expect(() =>
      getConfig({
        ...supabase,
        LLM_PRIMARY_PROVIDER: 'openai',
        LLM_FALLBACK_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'test-gemini-key',
        GEMINI_MODEL: 'gemini-test',
        OPENAI_API_KEY: 'test-openai-key',
        OPENAI_MODEL: 'gpt-test',
      }),
    ).toThrow('LLM_PRIMARY_PROVIDER=gemini');
    expect(() =>
      getConfig({
        ...supabase,
        LLM_PRIMARY_PROVIDER: 'gemini',
        LLM_FALLBACK_PROVIDER: 'openai',
        GEMINI_API_KEY: 'test-gemini-key',
        GEMINI_MODEL: 'gemini-test',
        OPENAI_API_KEY: 'test-openai-key',
        OPENAI_MODEL: 'gpt-test',
        NEXT_PUBLIC_SUPABASE_SECRET_KEY: 'forbidden-test-value',
      }),
    ).toThrow('NEXT_PUBLIC_');
    expect(() =>
      getConfig({
        ...supabase,
        ...providers,
        NEXT_PUBLIC_XAI_API_KEY: 'forbidden-test-value',
      }),
    ).toThrow('NEXT_PUBLIC_');
    expect(() =>
      getConfig({
        ...supabase,
        APP_MODE: ['de', 'mo'].join(''),
        LLM_PRIMARY_PROVIDER: 'gemini',
        LLM_FALLBACK_PROVIDER: 'openai',
        GEMINI_API_KEY: 'test-gemini-key',
        GEMINI_MODEL: 'gemini-test',
        OPENAI_API_KEY: 'test-openai-key',
        OPENAI_MODEL: 'gpt-test',
      }),
    ).toThrow();
  });
});

describe('v0.2 analytical semantics', () => {
  const scope = { project_external_id: 'P-ALPHA', zone_external_id: null };
  const calculationArtifactId = '50000000-0000-4000-8000-000000000001';

  it('builds a deterministic current-state brief with effective-date and hotspot support', () => {
    const calculation = analyze(
      [
        row({ unit_external_id: 'b', zone_external_id: 'Z-B' }),
        row({ unit_external_id: 'a', zone_external_id: 'Z-A', available_since: null }),
      ],
      ORG,
      scope,
      '2026-09-20',
    );
    const brief = buildDecisionBrief(calculation, calculationArtifactId, scope, '2026-09-20');
    expect(brief.current_state.map((signal) => signal.metric_key)).toEqual([
      'total_inventory',
      'available_inventory',
      'median_inventory_age_days',
      'slow_moving_rate',
    ]);
    expect(brief.requested_data_as_of).toBe('2026-09-20');
    expect(brief.effective_snapshot_date).toBe('2026-09-19');
    expect(brief.where_to_look[0]).toMatchObject({
      dimension: 'zone',
      segment_key: 'Z-A',
      support_value: 1,
      denominator_value: 2,
    });
    expect(brief.limitations[0]).toContain('unknown age');
    expect(
      brief.current_state
        .flatMap((signal) => signal.evidence)
        .every((reference) => reference.artifact_id === calculationArtifactId),
    ).toBe(true);
  });

  it('surfaces material comparisons in stable rule order with currency metadata', () => {
    const calculation = analyze(
      [
        row({
          unit_external_id: 'priced',
          snapshot_date: '2026-09-13',
          list_price: '100',
          area_sqm: '1',
        }),
        row({
          unit_external_id: 'priced',
          snapshot_date: '2026-09-20',
          list_price: '200',
          area_sqm: '1',
        }),
      ],
      ORG,
      scope,
      '2026-09-20',
    );
    const brief = buildDecisionBrief(calculation, calculationArtifactId, scope, '2026-09-20');
    const price = brief.material_changes.find(
      (signal) => signal.metric_key === 'median_price_per_area',
    );
    expect(price).toMatchObject({
      current_value: '200.000000',
      comparison_value: '100.000000',
      delta: '100.000000',
      unit: 'currency_per_sqm',
      currency: 'VND',
    });
    expect(brief.material_changes.map((signal) => signal.rule_id)).toEqual(
      [...brief.material_changes.map((signal) => signal.rule_id)].sort(),
    );
  });

  it('abstains from a segment hotspot for a zero available-inventory denominator', () => {
    const calculation = analyze(
      [row({ status: 'sold', sold_at: '2026-09-19' })],
      ORG,
      scope,
      '2026-09-19',
    );
    const brief = buildDecisionBrief(calculation, calculationArtifactId, scope, '2026-09-19');
    expect(brief.where_to_look[0]).toMatchObject({
      status: 'unavailable',
      support_value: null,
      denominator_value: 0,
      abstention_reason: 'ZERO_DENOMINATOR',
    });
  });

  it('registers every emitted metric with explicit semantics', () => {
    const calculated = calculate([row()], '2026-09-19');
    expect(calculated.metrics.map((metric) => metric.key).sort()).toEqual(
      Object.keys(metricRegistry).sort(),
    );
    expect(
      Object.values(metricRegistry).every(
        (definition) => definition.semanticVersion === 'mvp-inventory-v0.2',
      ),
    ).toBe(true);
  });

  it('uses exact deterministic age-bucket boundaries', () => {
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
    const result = calculate(
      availableDates.map((available_since, index) =>
        row({
          unit_external_id: `age-${index}`,
          snapshot_date: '2026-09-20',
          available_since,
        }),
      ),
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

  it('calculates decimal median, percentiles and IQR without binary floating-point money math', () => {
    const result = calculate(
      ['10', '20', '30', '40'].map((list_price, index) =>
        row({ unit_external_id: `price-${index}`, list_price, area_sqm: '1' }),
      ),
      '2026-09-19',
    );
    const metrics = Object.fromEntries(result.metrics.map((metric) => [metric.key, metric.value]));
    expect(metrics).toMatchObject({
      median_price_per_area: '25.000000',
      p25_price_per_area: '17.500000',
      p75_price_per_area: '32.500000',
      price_per_area_iqr: '15.000000',
    });
  });

  it('selects exact and nearest prior snapshots and separates points from relative percent', () => {
    const history = [
      row({ unit_external_id: 'one', snapshot_date: '2026-08-20', status: 'available' }),
      row({
        unit_external_id: 'two',
        snapshot_date: '2026-08-20',
        status: 'sold',
        sold_at: '2026-08-20',
      }),
      row({ unit_external_id: 'one', snapshot_date: '2026-09-13', status: 'available' }),
      row({ unit_external_id: 'two', snapshot_date: '2026-09-13', status: 'available' }),
      row({ unit_external_id: 'one', snapshot_date: '2026-09-20', status: 'available' }),
      row({
        unit_external_id: 'two',
        snapshot_date: '2026-09-20',
        status: 'sold',
        sold_at: '2026-09-20',
      }),
    ];
    const result = analyze(history, ORG, scope, '2026-09-20');
    const sevenDayRate = result.period_comparisons.find(
      (comparison) =>
        comparison.period_days === 7 && comparison.metric_key === 'available_inventory_rate',
    )!;
    expect(sevenDayRate.comparison_snapshot_date).toBe('2026-09-13');
    expect(sevenDayRate.percentage_point_delta).toBe('-50.000000');
    expect(sevenDayRate.relative_delta_pct).toBe('-50.000000');
    const thirtyDayInventory = result.period_comparisons.find(
      (comparison) =>
        comparison.period_days === 30 && comparison.metric_key === 'available_inventory',
    )!;
    expect(thirtyDayInventory.comparison_snapshot_date).toBe('2026-08-20');
    expect(thirtyDayInventory.absolute_delta).toBe(0);
  });

  it('abstains for missing history and zero denominators', () => {
    const result = analyze(
      [row({ snapshot_date: '2026-09-20', status: 'sold', sold_at: '2026-09-20' })],
      ORG,
      scope,
      '2026-09-20',
    );
    expect(
      result.period_comparisons.find(
        (comparison) =>
          comparison.period_days === 7 && comparison.metric_key === 'available_inventory',
      )?.abstention_reason,
    ).toBe('INSUFFICIENT_HISTORY');
    expect(result.metrics.find((metric) => metric.key === 'slow_moving_rate')).toMatchObject({
      value: null,
      abstention_reason: 'ZERO_DENOMINATOR',
    });
  });

  it('keeps absolute and percentage-point deltas available when relative change has a zero baseline', () => {
    const result = analyze(
      [
        row({
          snapshot_date: '2026-09-13',
          status: 'sold',
          sold_at: '2026-09-13',
        }),
        row({ snapshot_date: '2026-09-20', status: 'available', sold_at: null }),
      ],
      ORG,
      scope,
      '2026-09-20',
    );
    const inventory = result.period_comparisons.find(
      (comparison) =>
        comparison.period_days === 7 && comparison.metric_key === 'available_inventory',
    )!;
    expect(inventory).toMatchObject({
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

  it('does not compare monetary trends or segments across currencies', () => {
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

  it('propagates missing-age coverage into metrics, breakdowns, candidates, and charts', () => {
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
      'Aging metrics exclude 1 available unit(s) with unknown age (50.000000% of available inventory).',
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

  it('keeps breakdowns stable, scoped, and reconcilable', () => {
    const result = analyze(
      [
        row({ unit_external_id: 'a', zone_external_id: 'Z-B' }),
        row({ unit_external_id: 'b', zone_external_id: 'Z-A' }),
        row({
          unit_external_id: 'c',
          zone_external_id: 'Z-A',
          status: 'sold',
          sold_at: '2026-09-19',
        }),
      ],
      ORG,
      scope,
      '2026-09-19',
    );
    const zone = result.breakdowns.find(
      (breakdown) =>
        breakdown.dimension === 'zone' && breakdown.metric_key === 'available_inventory',
    )!;
    expect(zone.items.map((item) => item.key)).toEqual(['Z-A', 'Z-B']);
    expect(zone.items.reduce((sum, item) => sum + Number(item.value), 0)).toBe(
      result.metrics.find((metric) => metric.key === 'available_inventory')?.value,
    );
    expect(zone.semantic_version).toBe('mvp-inventory-v0.2');
    expect(zone.snapshot_refs).toHaveLength(3);
  });
});

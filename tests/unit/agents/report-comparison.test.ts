import { describe, expect, it } from 'vitest';
import type { ArtifactOf, Metric } from '@vda/contracts';
import {
  explicitComparisonRuns,
  metricDifference,
  reportMetricComparisons,
} from '../../../src/backend/agents/runtime/capabilities/compare-reports';
import type { AuthorizedAgentContextV1 } from '../../../src/backend/agents/runtime/context/types';

const metric = (value: Metric['value'], currency: string | null = null): Metric => ({
  key: currency ? 'median_price' : 'available_inventory',
  metric_id: 'metric',
  label: 'Inventory',
  description: 'Validated metric',
  value,
  unit: currency ? 'currency' : 'count',
  currency,
  status: 'available',
  abstention_reason: null,
});
const report = (id: string, metrics: Metric[]) =>
  ({
    run_id: `run-${id}`,
    artifact_id: id,
    data_as_of: '2026-09-19',
    payload: { metrics },
  }) as ArtifactOf<'report'>;

describe('explicit report comparison', () => {
  it('keeps decimal precision and absolute delta when a percentage baseline is zero', () => {
    expect(metricDifference('9007199254740993.25', '9007199254740992.50')).toBe('+0.75');
    expect(metricDifference('0.1', '0.2')).toBe('-0.1');
    expect(metricDifference(10, 0)).toBe('+10');
    expect(metricDifference(0, 0)).toBe('0');
    expect(metricDifference(1e30, 1)).toBeNull();
  });

  it('binds both values to evidence and refuses incompatible currency comparisons', () => {
    const result = reportMetricComparisons(
      report('left', [metric(0), metric('12.30', 'USD')]),
      report('right', [metric(4), metric('13.10', 'EUR')]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.display_value).toBe('0 → 4; Δ +4 căn');
    expect(result[0]?.grounding_refs).toEqual([
      {
        type: 'metric',
        ref: {
          run_id: 'run-left',
          artifact_id: 'left',
          metric_key: 'available_inventory',
          evidence_path: 'payload.metrics[0].value',
        },
      },
      {
        type: 'metric',
        ref: {
          run_id: 'run-right',
          artifact_id: 'right',
          metric_key: 'available_inventory',
          evidence_path: 'payload.metrics[0].value',
        },
      },
    ]);
  });

  it('permits multi-run grounding only for explicitly selected authorized reports', () => {
    const context = {
      request: { agent_target: 'comparison' },
      allowed_report_refs: [
        { report_id: 'r1', run_id: 'one' },
        { report_id: 'r2', run_id: 'two' },
      ],
      provider_context: {
        context_source: 'message',
        referenced_context: [
          { type: 'report', id: 'r1', run_id: 'one' },
          { type: 'report', id: 'r2', run_id: 'two' },
          { type: 'report', id: 'forged', run_id: 'three' },
        ],
      },
    } as unknown as AuthorizedAgentContextV1;
    expect([...explicitComparisonRuns(context)]).toEqual(['one', 'two']);
    expect(
      explicitComparisonRuns({
        ...context,
        provider_context: { ...context.provider_context, context_source: 'thread' },
      }).size,
    ).toBe(0);
  });
});

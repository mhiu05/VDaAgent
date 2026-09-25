import { decimalOf } from '../core/decimal';
import type { CalculationPayload } from '@vda/contracts/analysis/calculation';
import type { AbstentionReason } from '@vda/contracts/analysis/metrics';
import { getMetricDefinition } from '../metrics/registry';

export function buildSegmentComparisons(
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

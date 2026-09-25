import { Money, decimalOf } from '../core/decimal';
import type { CalculationPayload } from '@vda/contracts/analysis/calculation';
import type { Scope } from '@vda/contracts/common/primitives';
import { getMetricDefinition } from '../metrics/registry';

export const notableChangeRules = Object.freeze({
  version: 'notable-change-v0.2',
  inventory_relative_pct: new Money(10),
  rate_percentage_points: new Money(5),
  price_relative_pct: new Money(10),
  material_relative_pct: new Money(20),
  material_rate_percentage_points: new Money(10),
});

export function detectChanges(
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

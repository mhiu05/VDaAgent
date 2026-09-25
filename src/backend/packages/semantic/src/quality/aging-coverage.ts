import { metricOf } from '../metrics/inventory-summary';
import { decimalOf } from '../core/decimal';
import type { Metric } from '@vda/contracts/analysis/metrics';

export function agingLimitations(metrics: Metric[]): string[] {
  const missing = metricOf(metrics, 'unknown_inventory_age');
  const rate = metricOf(metrics, 'unknown_inventory_age_rate');
  if (!missing || !rate || missing.value === null || rate.value === null) return [];
  if (decimalOf(missing.value).eq(0)) return [];
  return [
    `Aging metrics exclude ${missing.value} available unit(s) with unknown age (${rate.value}% of available inventory).`,
  ];
}

import { SEMANTIC_VERSION } from '@vda/contracts/common/primitives';
import { metricRegistry } from './metrics/registry';
import type { MetricKey } from '@vda/contracts/analysis/metrics';

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

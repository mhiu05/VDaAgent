import type { ArtifactOf } from '@vda/contracts/artifacts/artifact';
import type { ReportSection } from '@vda/contracts/reports/section';

/**
 * The deterministic, legacy-compatible report section projection. It belongs
 * in the domain package so both Report Agent composition and publication-time
 * validation use the same implementation.
 */
export function reportSections(
  calculation: ArtifactOf<'calculation'>,
  chart: ArtifactOf<'visual_evidence'>,
  comparison: ArtifactOf<'comparison'>,
  insight: ArtifactOf<'insight'>,
): ReportSection[] {
  const metricAvailable = (key: (typeof calculation.payload.metrics)[number]['key']) =>
    calculation.payload.metrics.some((metric) => metric.key === key && metric.value !== null);
  const agingLimitations = calculation.payload.quality_limitations;
  const section = (
    key: ReportSection['key'],
    title: string,
    metricKeys: ReportSection['metric_keys'],
    artifactRefs: string[],
    status: ReportSection['status'] = 'available',
    limitations: string[] = [],
  ): ReportSection => ({
    key,
    title,
    metric_keys: metricKeys,
    artifact_refs: artifactRefs,
    status,
    limitations,
  });
  return [
    section(
      'executive_summary',
      'Tóm tắt điều hành',
      insight.payload.claims.map((claim) => claim.metric_key),
      [insight.artifact_id],
      insight.payload.claims.length ? 'available' : 'unavailable',
    ),
    section(
      'inventory_overview',
      'Tổng quan tồn kho',
      ['total_inventory', 'available_inventory', 'available_inventory_rate'],
      [calculation.artifact_id, chart.artifact_id],
      metricAvailable('total_inventory') ? 'available' : 'unavailable',
    ),
    section(
      'trend',
      'Xu hướng',
      ['inventory_change_7d', 'inventory_change_30d', 'inventory_change_90d'],
      [calculation.artifact_id, chart.artifact_id],
      calculation.payload.period_comparisons.some((item) => item.abstention_reason === null)
        ? 'available'
        : 'unavailable',
    ),
    section(
      'aging_analysis',
      'Thời gian tồn kho',
      ['median_inventory_age_days', 'p75_inventory_age_days', 'slow_moving_rate'],
      [calculation.artifact_id, chart.artifact_id],
      metricAvailable('slow_moving_rate')
        ? agingLimitations.length
          ? 'limited'
          : 'available'
        : 'unavailable',
      agingLimitations,
    ),
    section(
      'price_analysis',
      'Phân tích giá',
      ['median_price', 'median_price_per_area', 'price_per_area_iqr'],
      [calculation.artifact_id, chart.artifact_id],
      calculation.payload.metrics.some(
        (item) => item.key === 'median_price_per_area' && item.value !== null,
      )
        ? 'available'
        : 'unavailable',
    ),
    section(
      'segment_analysis',
      'Phân tích phân khúc',
      ['available_inventory', 'slow_moving_rate'],
      [calculation.artifact_id, chart.artifact_id],
      calculation.payload.breakdowns.length ? 'available' : 'unavailable',
    ),
    section(
      'comparison',
      'So sánh',
      ['median_price_per_area', 'available_inventory'],
      [comparison.artifact_id, chart.artifact_id],
      comparison.payload.items.some((item) => item.abstention_reason === null) ||
        comparison.payload.period_comparisons.some((item) => item.abstention_reason === null) ||
        comparison.payload.segment_comparisons.some((item) => item.abstention_reason === null)
        ? 'available'
        : 'unavailable',
    ),
    section(
      'data_quality_limitations',
      'Chất lượng dữ liệu và giới hạn',
      [
        'missing_inventory_age_rate',
        'missing_price_rate',
        'missing_area_rate',
        'snapshot_coverage',
      ],
      [calculation.artifact_id],
      'available',
      [...calculation.limitations, ...calculation.payload.quality_limitations],
    ),
    section(
      'evidence_lineage',
      'Nguồn bằng chứng',
      [],
      [calculation.artifact_id, chart.artifact_id, comparison.artifact_id, insight.artifact_id],
    ),
  ];
}

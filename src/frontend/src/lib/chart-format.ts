import type { ChartSeries, ChartValueFormat, Metric, MetricUnit } from '@vda/contracts';

const metricFormat: Record<MetricUnit, ChartValueFormat> = {
  count: 'integer',
  percent: 'percent',
  percentage_points: 'percentage_points',
  days: 'days',
  currency: 'currency',
  currency_per_sqm: 'currency_per_area',
};

export function formatChartValue(
  value: number | null,
  format: ChartValueFormat,
  currency: string | null = null,
): string {
  if (value === null) return 'Unavailable';
  if (format === 'integer')
    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value);
  if (format === 'percent')
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)}%`;
  if (format === 'percentage_points')
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)} pp`;
  if (format === 'days')
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value)} days`;
  if (format === 'currency' || format === 'currency_per_area') {
    const formatted = currency
      ? new Intl.NumberFormat('vi-VN', {
          style: 'currency',
          currency,
          maximumFractionDigits: 2,
        }).format(value)
      : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
    return format === 'currency_per_area' ? `${formatted}/m²` : formatted;
  }
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
}

export function formatSeriesValue(value: number | null, series: ChartSeries): string {
  return formatChartValue(value, series.value_format, series.currency);
}

export function formatMetricValue(metric: Metric): string {
  if (metric.value === null) return 'Unavailable';
  const value = Number(metric.value);
  if (!Number.isFinite(value)) return 'Unavailable';
  return formatChartValue(value, metricFormat[metric.unit], metric.currency);
}

import type { DateRange, SourceMeta } from '../../reports/index';
import type { InventorySummary, TrendPoint } from '../model/types';

/** Renderer-independent. All rows also serve as the accessible data-table source. */
export function inventoryChart(summary: InventorySummary, source: SourceMeta, snapshotDate: string) {
  return {
    title: 'Phân bố tuổi tồn kho', question: 'Tồn kho tập trung ở độ tuổi nào?',
    xLabel: 'Số căn', yLabel: 'Tuổi tồn (ngày)', unit: 'căn', snapshotDate, source,
    legend: ['Số căn khả dụng', 'Chưa rõ tuổi: thiếu ngày hoặc ngày không hợp lệ'],
    rows: summary.bins.map(bin => ({ ...bin, denominator: summary.total, share: summary.total ? bin.count / summary.total * 100 : null })),
    completeness: { eligible: summary.eligible, total: summary.total, unknown: summary.unknown, coverage: summary.coverage },
    interpretation: `${summary.slow} căn có tuổi từ 180 ngày; ${summary.unknown} căn chưa rõ tuổi. Chính sách mô phỏng.`,
  };
}
export function transactionChart(points: readonly TrendPoint[], currentPeriod: DateRange, previousPeriod: DateRange, source: SourceMeta) {
  const total = (key: 'current' | 'previous') => points.some(p => p[key] === null) ? null : points.reduce((sum, p) => sum + p[key]!, 0);
  const current = total('current'); const previous = total('previous');
  return {
    title: 'Nhịp hoàn tất giao dịch', question: 'Nhịp giao dịch thay đổi thế nào giữa hai kỳ?',
    xLabel: 'Ngày thứ trong kỳ (ngày thực có trong bảng)', yLabel: 'Giao dịch / ngày', unit: 'giao dịch/ngày',
    currentPeriod, previousPeriod, source, rows: [...points],
    legend: [`${currentPeriod.from} → ${currentPeriod.to} (không gồm ngày cuối)`, `${previousPeriod.from} → ${previousPeriod.to} (không gồm ngày cuối)`],
    totals: { current, previous }, gapsAreMissing: true,
    interpretation: current === null || previous === null ? 'Kỳ có ngày thiếu nguồn; không so sánh tổng kỳ.' : `${current} so với ${previous} giao dịch trong hai kỳ cùng độ dài. Không suy đoán nguyên nhân.`,
  };
}

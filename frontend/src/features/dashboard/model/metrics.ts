import type { DateRange, ReportScope } from '../../reports/index';
import { RepositoryError } from '../../reports/model/types';
import { businessDate, inPeriod, validDate, validInstant, validateRange } from '../../reports/model/query';
import type { DashboardDataset, InventorySnapshot, InventorySummary, Metric, PropertySnapshot, TransactionPoint, TrendPoint } from './types';

export const DEMO_POLICY = 'slow-demo-180d-v1';
export function daysBetween(from: string, to: string): number | null {
  return validDate(from) && validDate(to) ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) : null;
}
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
}
export function previousPeriod(scope: DateRange): DateRange {
  validateRange(scope.from, scope.to, scope.timezone);
  return { from: addDays(scope.from, -(daysBetween(scope.from, scope.to)!)), to: scope.from, timezone: scope.timezone };
}
export function percentageChange(current: number | null, baseline: number | null): number | null {
  return current === null || baseline === null || baseline === 0 ? null : (current - baseline) / baseline * 100;
}
/** Conflicting duplicates are excluded with quality evidence, rather than picking an arbitrary value. */
export function deduplicate<T extends { id: string }>(rows: readonly T[]): { rows: T[]; conflicts: string[] } {
  const found = new Map<string, T>(); const conflicts = new Set<string>();
  for (const row of rows) {
    const previous = found.get(row.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) conflicts.add(row.id);
    else found.set(row.id, row);
  }
  return { rows: [...found.values()].filter(row => !conflicts.has(row.id)), conflicts: [...conflicts] };
}
export function ageBand(property: PropertySnapshot, date: string): InventorySummary['bins'][number]['id'] {
  const age = property.listedBusinessDate ? daysBetween(property.listedBusinessDate, date) : null;
  return age === null || age < 0 ? 'unknown' : age < 90 ? 'young' : age < 180 ? 'middle' : age < 360 ? 'slow' : 'old';
}
export function inventorySummary(snapshot: InventorySnapshot, projectIds: readonly string[]): InventorySummary {
  const unique = deduplicate(snapshot.properties.filter(p => projectIds.includes(p.projectId)));
  const available = unique.rows.filter(p => p.status === 'available');
  const bins: InventorySummary['bins'] = [
    { id: 'young', label: '0–89 ngày', count: 0 }, { id: 'middle', label: '90–179 ngày', count: 0 },
    { id: 'slow', label: '180–359 ngày', count: 0 }, { id: 'old', label: 'Từ 360 ngày', count: 0 }, { id: 'unknown', label: 'Chưa rõ tuổi', count: 0 },
  ];
  const invalidIds = [...unique.conflicts];
  for (const property of available) {
    const band = ageBand(property, snapshot.businessDate);
    bins.find(bin => bin.id === band)!.count++;
    if (band === 'unknown') invalidIds.push(property.id);
  }
  const unknown = bins[4].count; const total = available.length; const eligible = total - unknown;
  const slow = bins[2].count + bins[3].count;
  return { total, eligible, slow, unknown, bins, invalidIds, share: eligible ? slow / eligible * 100 : null, coverage: total ? eligible / total * 100 : null };
}
export function closingSnapshot(data: DashboardDataset, closingBefore: string): InventorySnapshot | null {
  return data.snapshots.find(s => s.closingBefore === closingBefore && s.source.completeness !== 'missing') ?? null;
}
export function inventoryMetrics(data: DashboardDataset, scope: ReportScope, projects: readonly string[]): { metrics: Metric[]; summary: InventorySummary | null } {
  const baselineScope = previousPeriod(scope);
  const current = scope.timezone === data.businessTimezone ? closingSnapshot(data, scope.to) : null;
  const baseline = scope.timezone === data.businessTimezone ? closingSnapshot(data, scope.from) : null;
  const summary = current ? inventorySummary(current, projects) : null;
  const before = baseline ? inventorySummary(baseline, projects) : null;
  const comparable = !!current && !!baseline && current.policyVersion === baseline.policyVersion
    && current.source.completeness === 'full' && baseline.source.completeness === 'full'
    && !deduplicate(current.properties.filter(p => projects.includes(p.projectId))).conflicts.length
    && !deduplicate(baseline.properties.filter(p => projects.includes(p.projectId))).conflicts.length
    && (summary?.coverage ?? 0) >= 90 && (before?.coverage ?? 0) >= 90;
  const quality = !summary ? 'missing' : summary.unknown || summary.invalidIds.length || current?.source.completeness !== 'full' ? 'partial' : 'full';
  const base = { scope, baselineScope, source: current?.source ?? null, policyVersion: current?.policyVersion ?? DEMO_POLICY, quality } as const;
  const inventoryValue = summary?.total ?? null; const inventoryBefore = before?.total ?? null;
  const shareValue = summary?.share ?? null; const shareBefore = comparable ? before?.share ?? null : null;
  const stockComparable = !!current && !!baseline && current.source.completeness === 'full' && baseline.source.completeness === 'full'
    && !deduplicate(current.properties.filter(p => projects.includes(p.projectId))).conflicts.length && !deduplicate(baseline.properties.filter(p => projects.includes(p.projectId))).conflicts.length;
  return { summary, metrics: [
    { ...base, id: 'inventory', value: inventoryValue, unit: 'căn', baseline: stockComparable ? inventoryBefore : null, delta: stockComparable ? percentageChange(inventoryValue, inventoryBefore) : null,
      deltaUnit: '%', absoluteDelta: stockComparable && inventoryValue !== null && inventoryBefore !== null ? inventoryValue - inventoryBefore : null,
      numerator: inventoryValue, denominator: null, reason: !summary ? 'missingSnapshot' : !stockComparable ? 'missingComparableBaseline' : inventoryBefore === 0 ? 'zeroBaseline' : null, inspect: 'inventory' },
    { ...base, id: 'slowShare', value: shareValue, unit: '%', baseline: shareBefore, delta: shareValue !== null && shareBefore !== null ? shareValue - shareBefore : null,
      deltaUnit: 'percentagePoints', absoluteDelta: null, numerator: summary?.slow ?? null, denominator: summary?.eligible ?? null,
      reason: shareValue === null ? 'missingDenominator' : !comparable ? 'incomparableBaseline' : null, inspect: 'slow' },
  ] };
}
export function transactionSeries(data: DashboardDataset, period: DateRange, projects: readonly string[]): TransactionPoint[] {
  validateRange(period.from, period.to, period.timezone);
  if ((daysBetween(period.from, period.to) ?? 0) > 366) throw new RepositoryError('validation', 'Demo daily series supports at most 366 days');
  const unique = deduplicate(data.transactions.filter(t => projects.includes(t.projectId)));
  const invalid = unique.rows.some(t => !t.test && t.status === 'completed' && (!t.completedAt || !validInstant(t.completedAt)));
  const rows = unique.rows.filter(t => !t.test && t.status === 'completed' && inPeriod(t.completedAt, period.from, period.to, period.timezone));
  const counts = new Map<string, number>();
  for (const row of rows) {
    const date = businessDate(row.completedAt!, period.timezone)!;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const points: TransactionPoint[] = [];
  for (let date = period.from; date < period.to; date = addDays(date, 1)) {
    const covered = data.transactionSource.completeness !== 'missing' && period.timezone === data.businessTimezone && data.coveredDates.includes(date);
    points.push({ date, value: covered && !unique.conflicts.length && !invalid ? counts.get(date) ?? 0 : null });
  }
  return points;
}
export function transactionMetric(data: DashboardDataset, scope: ReportScope, projects: readonly string[]): { metric: Metric; trend: TrendPoint[] } {
  const baselineScope = previousPeriod(scope);
  const current = transactionSeries(data, scope, projects); const previous = transactionSeries(data, baselineScope, projects);
  const full = (points: TransactionPoint[]) => points.every(p => p.value !== null);
  const sum = (points: TransactionPoint[]) => points.reduce((total, p) => total + (p.value ?? 0), 0);
  const value = full(current) ? sum(current) : null; const baseline = full(previous) ? sum(previous) : null;
  return { metric: { id: 'transactions', value, baseline, delta: percentageChange(value, baseline), absoluteDelta: value !== null && baseline !== null ? value - baseline : null,
    deltaUnit: '%', unit: 'giao dịch', numerator: value, denominator: null, scope, baselineScope, source: data.transactionSource, policyVersion: DEMO_POLICY,
    quality: value === null ? 'partial' : 'full', reason: value === null ? 'incompletePeriod' : baseline === null ? 'missingBaseline' : baseline === 0 ? 'zeroBaseline' : null, inspect: 'transactions' },
    trend: current.map((p, index) => ({ day: index + 1, currentDate: p.date, previousDate: previous[index].date, current: p.value, previous: previous[index].value })),
  };
}

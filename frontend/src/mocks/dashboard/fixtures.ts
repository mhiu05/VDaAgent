import type { DashboardDataset, InventorySnapshot, PropertySnapshot, Transaction, AnalysisTask, Project } from '../../features/dashboard/model/types';
import type { ReportDataset, SourceMeta } from '../../features/reports/index';
import { addDays } from '../../features/dashboard/model/metrics';
import { createReportFixtures, demoScope, previousScope } from '../reports/fixtures';

export const inventorySource: SourceMeta = { id: 'source-inventory', mode: 'mock', label: 'Snapshot tồn kho mô phỏng', dataThrough: '2026-10-15T16:59:59Z', updatedAt: '2026-10-16T01:30:00Z', completeness: 'full' };
export const projects: readonly Project[] = [
  { id: 'P-A', name: 'VDA Demo Riverside', marketId: 'HCM', marketLabel: 'TP.HCM', sourceId: inventorySource.id },
  { id: 'P-B', name: 'VDA Demo Green Park', marketId: 'BD', marketLabel: 'Bình Dương', sourceId: inventorySource.id },
  { id: 'P-C', name: 'VDA Demo Long Garden', marketId: 'LA', marketLabel: 'Long An', sourceId: inventorySource.id },
];
function snapshot(baseline: boolean): InventorySnapshot {
  const id = baseline ? 'snapshot-baseline' : 'snapshot-current';
  const date = baseline ? '2026-09-15' : '2026-10-15';
  const distributions = baseline ? [[30, 16, 12, 6, 2], [20, 12, 6, 4, 2], [12, 6, 2, 2, 0]] : [[24, 12, 14, 6, 4], [18, 10, 8, 4, 0], [8, 6, 2, 2, 2]];
  const properties: PropertySnapshot[] = [];
  distributions.forEach((bins, project) => {
    let index = 0;
    bins.forEach((count, band) => {
      for (let i = 0; i < count; i++) properties.push({
        id: `${projects[project].id}-property-${String(++index).padStart(3, '0')}`, projectId: projects[project].id,
        snapshotId: id, status: 'available', sourceId: inventorySource.id,
        listedBusinessDate: band === 4 ? null : addDays(date, -([30, 120, 220, 400][band] + i % 5)),
      });
    });
    // Non-available records make membership exclusions observable.
    for (const status of ['reserved', 'sold', 'withdrawn'] as const) properties.push({ id: `${projects[project].id}-${status}`, projectId: projects[project].id, snapshotId: id, status, listedBusinessDate: addDays(date, -220), sourceId: inventorySource.id });
  });
  return { id, businessDate: date, closingBefore: baseline ? demoScope.from : demoScope.to, policyVersion: 'slow-demo-180d-v1', properties,
    source: baseline ? { ...inventorySource, dataThrough: '2026-09-15T16:59:59Z', updatedAt: '2026-09-16T01:30:00Z' } : { ...inventorySource } };
}
export function createDashboardFixtures(reports: ReportDataset = createReportFixtures()): DashboardDataset {
  const transactions: Transaction[] = []; const tasks: AnalysisTask[] = [];
  for (const baseline of [false, true]) {
    const scope = baseline ? previousScope : demoScope; const counts = baseline ? [28, 16, 6] : [24, 15, 6];
    counts.forEach((count, project) => {
      for (let i = 0; i < count; i++) transactions.push({ id: `tx-${baseline ? 'previous' : 'current'}-${project}-${i}`, propertyId: `${projects[project].id}-sold`, projectId: projects[project].id,
        status: 'completed', completedAt: `${addDays(scope.from, (i * 7 + project) % 30)}T03:00:00Z`, test: false, sourceId: 'source-transactions' });
    });
  }
  transactions.push(...['cancelled', 'reserved'].map((status, i) => ({ id: `excluded-${i}`, propertyId: 'P-A-sold', projectId: 'P-A', status: status as 'cancelled' | 'reserved', completedAt: null, test: false, sourceId: 'source-transactions' })));
  transactions.push({ ...transactions[0], id: 'test-transaction', test: true });
  reports.versions.forEach(version => tasks.push({
    id: `task-${version.id}`, projectId: reports.records.find(r => r.id === version.reportId)!.projectIds[0], state: 'succeeded', createdAt: reports.records.find(r => r.id === version.reportId)!.createdAt,
    observedAt: '2026-10-16T01:55:00Z', failedAt: null, attemptNumber: version.sequence, reportId: version.reportId, versionId: version.id, error: null,
  }));
  for (let i = 0; i < 9; i++) {
    const state = i < 4 ? 'succeeded' : i < 6 ? 'running' : i === 6 ? 'queued' : 'failed';
    const reportId = i === 4 ? 'R013' : i === 5 ? 'R014' : i === 7 ? 'R015' : i === 8 ? 'R016' : null;
    const projectId = reportId ? reports.records.find(r => r.id === reportId)!.projectIds[0] : projects[i % 3].id;
    tasks.push({ id: `task-analysis-${i}`, projectId, state, createdAt: '2026-10-10T01:00:00Z', observedAt: '2026-10-16T01:55:00Z', failedAt: state === 'failed' ? '2026-10-15T02:00:00Z' : null,
      attemptNumber: 1, reportId, versionId: null,
      error: state === 'failed' ? 'Nguồn demo chưa phản hồi; không phải sự cố hệ thống thực.' : null });
  }
  const coveredDates: string[] = [];
  for (let date = previousScope.from; date < demoScope.to; date = addDays(date, 1)) coveredDates.push(date);
  return { businessTimezone: 'Asia/Bangkok', projects: structuredClone(projects), snapshots: [snapshot(false), snapshot(true)], transactions, tasks, coveredDates,
    transactionSource: { ...inventorySource, id: 'source-transactions', label: 'Giao dịch mô phỏng' },
    taskSource: { ...inventorySource, id: 'source-tasks', label: 'Lịch sử công việc mô phỏng', dataThrough: '2026-10-16T01:55:00Z', updatedAt: '2026-10-16T01:55:00Z' } };
}

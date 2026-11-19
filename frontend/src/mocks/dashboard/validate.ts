import type { DashboardDataset } from '../../features/dashboard/index';
import type { Clock, ReportDataset } from '../../features/reports/index';
import { validDate, validInstant } from '../../features/reports/model/query';

export function validateDashboard(data: DashboardDataset, reports: ReportDataset, clock: Clock): string[] {
  const errors: string[] = [];
  const sources = [data.transactionSource, data.taskSource, ...data.snapshots.map(s => s.source)];
  const sourceIds = sources.map(s => s.id);
  const projectIds = data.projects.map(p => p.id);
  const propertyIds = data.snapshots.flatMap(s => s.properties.map(p => p.id));
  for (const source of sources) if (source.mode !== 'mock' || !validInstant(source.dataThrough) || !validInstant(source.updatedAt) || Date.parse(source.dataThrough) > Date.parse(source.updatedAt) || Date.parse(source.updatedAt) > clock.now().getTime()) errors.push(`${source.id}: source chronology`);
  for (const snapshot of data.snapshots) {
    if (!validDate(snapshot.businessDate) || !validDate(snapshot.closingBefore) || snapshot.businessDate >= snapshot.closingBefore) errors.push(`${snapshot.id}: business date`);
    if (new Set(snapshot.properties.map(p => p.id)).size !== snapshot.properties.length) errors.push(`${snapshot.id}: duplicate property`);
    for (const property of snapshot.properties) if (property.snapshotId !== snapshot.id || !projectIds.includes(property.projectId) || !sourceIds.includes(property.sourceId)) errors.push(`${property.id}: relationship`);
  }
  if (new Set(data.transactions.map(t => t.id)).size !== data.transactions.length) errors.push('duplicate transaction');
  for (const transaction of data.transactions) if (!projectIds.includes(transaction.projectId) || !propertyIds.includes(transaction.propertyId) || !transaction.propertyId.startsWith(transaction.projectId) || !sourceIds.includes(transaction.sourceId) || (transaction.status === 'completed' && (!transaction.completedAt || !validInstant(transaction.completedAt)))) errors.push(`${transaction.id}: transaction`);
  if (new Set(data.tasks.map(t => t.id)).size !== data.tasks.length) errors.push('duplicate task');
  for (const task of data.tasks) {
    if (!projectIds.includes(task.projectId) || !validInstant(task.createdAt) || !validInstant(task.observedAt) || Date.parse(task.createdAt) > Date.parse(task.observedAt) || Date.parse(task.observedAt) > clock.now().getTime()) errors.push(`${task.id}: task chronology/project`);
    if (task.reportId && !reports.records.some(r => r.id === task.reportId && r.projectIds.includes(task.projectId))) errors.push(`${task.id}: report`);
    if (task.versionId && !reports.versions.some(v => v.id === task.versionId && v.reportId === task.reportId)) errors.push(`${task.id}: version`);
  }
  return errors;
}

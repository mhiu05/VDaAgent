import type { Attention, DashboardDataset, InventorySummary, Project } from './types';
import { DEMO_POLICY, deduplicate } from './metrics';

export function attentionItems(data: DashboardDataset, summary: InventorySummary | null, projects: { project: Project; summary: InventorySummary }[], failedIds: string[], snapshotId?: string): Attention[] {
  const items: Attention[] = [];
  const snapshot = data.snapshots.find(s => s.id === snapshotId);
  if (summary && snapshot && summary.total > 0 && summary.unknown > 0) items.push({
    id: 'age-quality', rule: 'AT01', evidenceIds: [snapshot.id, ...summary.invalidIds], projectId: null,
    text: `${summary.unknown}/${summary.total} căn chưa có tuổi tồn hợp lệ.`, policyVersion: DEMO_POLICY, observedAt: snapshot.source.dataThrough,
  });
  if (failedIds.length) items.push({ id: 'failed-tasks', rule: 'AT02', evidenceIds: failedIds, projectId: null, text: `${failedIds.length} công việc còn lỗi trong kỳ.`, policyVersion: DEMO_POLICY, observedAt: data.taskSource.dataThrough });
  for (const row of projects) {
    if (snapshot && snapshot.source.completeness === 'full' && snapshot.policyVersion === DEMO_POLICY && !deduplicate(snapshot.properties.filter(p => p.projectId === row.project.id)).conflicts.length
      && row.summary.eligible >= 20 && (row.summary.coverage ?? 0) >= 90 && (row.summary.share ?? 0) >= 35) items.push({
      id: `priority-${row.project.id}`, rule: 'AT03', evidenceIds: [snapshot.id, ...snapshot.properties.filter(p => p.projectId === row.project.id && p.status === 'available').map(p => p.id)],
      projectId: row.project.id, text: `${row.project.name}: ${row.summary.slow}/${row.summary.eligible} căn đủ dữ liệu có tuổi từ 180 ngày; cần kiểm tra thêm.`, policyVersion: DEMO_POLICY, observedAt: snapshot.source.dataThrough,
    });
  }
  return items.slice(0, 3);
}

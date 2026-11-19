import type { DashboardDataset } from '../../features/dashboard/index';
import { addDays } from '../../features/dashboard/model/metrics';
import { createDashboardFixtures } from './fixtures';

export type DashboardScenario = 'S01' | 'S02' | 'S04' | 'S05' | 'S06' | 'S07' | 'S11' | 'S17';
export function createDashboardScenario(id: DashboardScenario): DashboardDataset {
  const data = createDashboardFixtures();
  const current = data.snapshots.find(s => s.id === 'snapshot-current')!;
  if (id === 'S02') { current.properties = []; data.transactions = []; }
  if (id === 'S04') for (const row of current.properties) row.listedBusinessDate = null;
  if (id === 'S05') data.snapshots = [current];
  if (id === 'S06') data.coveredDates = data.coveredDates.filter(date => date !== '2026-09-20' && date !== '2026-10-01');
  if (id === 'S11') data.projects[0].name = 'Dự án mô phỏng có tên rất dài để kiểm tra khả năng hiển thị tiếng Việt có dấu, đọc toàn bộ nhãn và giới hạn chiều rộng vùng nội dung trên thiết bị nhỏ';
  if (id === 'S17') {
    current.properties[0].listedBusinessDate = addDays(current.businessDate, 1);
    data.transactions = data.transactions.filter(t => !t.id.startsWith('tx-previous'));
  }
  // S07 uses a one-shot fail callback for dashboard.inventory, not corrupted seed data.
  return data;
}

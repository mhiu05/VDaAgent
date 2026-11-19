import type { AdminDataset } from '../../features/admin-users/index';
import { createAdminFixtures } from './fixtures';

export function createAdminScenario(id: 'S01' | 'S11' | 'S12' | 'S13' | 'S14'): AdminDataset {
  const data = createAdminFixtures();
  if (id === 'S11') {
    data.users[0].name = 'Nguyễn Hoàng Minh Anh — Tài khoản mô phỏng với tên dài phục vụ kiểm tra hiển thị trên màn hình nhỏ, chi tiết tài khoản và hộp thoại xác nhận';
    data.users[0].email = `${'long-demo-name.'.repeat(5)}user@example.invalid`;
  }
  // Failure, stale revision, response loss and denied role are adapter/request inputs in S12–S14.
  return data;
}

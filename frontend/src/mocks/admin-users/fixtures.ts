import type { AdminDataset, ManagedUser } from '../../features/admin-users/index';

export function createAdminFixtures(): AdminDataset {
  const names = ['Nguyễn Minh Anh', 'Trần Bảo Hân', 'Lê Quốc Huy', 'Đặng Hoàng Phúc', 'Vũ Thảo Nguyên', 'Phạm Khánh Linh'];
  const users: ManagedUser[] = Array.from({ length: 24 }, (_, index) => ({
    id: `user-${String(index + 1).padStart(2, '0')}`, name: names[index % names.length] + (index >= 6 ? ` ${index + 1}` : ''),
    email: `demo.user.${index + 1}@example.invalid`, role: 'USER', status: index < 20 ? 'active' : 'disabled',
    createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T02:00:00Z`,
    lastActiveAt: index % 5 === 0 ? null : `2026-10-${String(1 + index % 15).padStart(2, '0')}T02:00:00Z`, revision: 1,
  }));
  return { users, audit: [] };
}

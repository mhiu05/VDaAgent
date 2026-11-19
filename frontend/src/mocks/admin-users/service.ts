import type { AdminDataset, AdminMockOptions } from '../../features/admin-users/index';
import { createAdminUsersRepository } from './repository';
import { createAdminFixtures } from './fixtures';

export function createAdminUsersMockService(options: AdminMockOptions, fixtures: AdminDataset = createAdminFixtures()) {
  return createAdminUsersRepository(fixtures, options);
}

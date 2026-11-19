import type { AdminDataset } from '../../features/admin-users/index';
import { createAdminFixtures } from './fixtures';
/** Harness-only deterministic S16 data. */
export function createStressUsers(count = 10_000): AdminDataset {
  const sample = createAdminFixtures();
  return { audit: [], users: Array.from({ length: count }, (_, i) => ({ ...sample.users[i % sample.users.length], id: `stress-user-${String(i).padStart(5, '0')}`, email: `stress.${i}@example.invalid` })) };
}

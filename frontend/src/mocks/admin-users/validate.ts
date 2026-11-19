import type { AdminDataset } from '../../features/admin-users/index';
import { validInstant } from '../../features/reports/model/query';

export function validateAdmin(data: AdminDataset): string[] {
  const errors: string[] = [];
  if (new Set(data.users.map(u => u.id)).size !== data.users.length) errors.push('duplicate user');
  for (const user of data.users) if (user.role !== 'USER' || !user.email.endsWith('@example.invalid') || !validInstant(user.createdAt) || (user.lastActiveAt !== null && (!validInstant(user.lastActiveAt) || Date.parse(user.lastActiveAt) < Date.parse(user.createdAt))) || user.revision < 1) errors.push(`${user.id}: managed USER`);
  if (new Set(data.audit.map(a => a.operationId)).size !== data.audit.length) errors.push('duplicate audit operation');
  return errors;
}

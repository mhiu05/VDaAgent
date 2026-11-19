import { RepositoryError } from '../../features/reports/index';
import type { AdminDataset, AdminMockOptions, AdminUsersRepository, ChangeStatus, MutationResult } from '../../features/admin-users/model/types';
import { queryUsers } from '../../features/admin-users/model/query';
import { mockRead } from '../reports/runtime';

export function createAdminUsersRepository(seed: AdminDataset, options: AdminMockOptions): AdminUsersRepository {
  const original = structuredClone(seed);
  let data = structuredClone(original); const principal = structuredClone(options.principal);
  let pending = 0;
  const operations = new Map<string, { command: string; result: MutationResult }>();
  const authorize = () => { if (principal.role !== 'ADMIN') throw new RepositoryError('forbidden', 'User management requires ADMIN'); };
  const target = (id: string) => {
    const user = data.users.find(u => u.id === id);
    if (!user || user.role !== 'USER' || user.id === principal.id) throw new RepositoryError('notFound', 'Managed USER not found');
    return user;
  };
  const commandKey = (command: ChangeStatus) => JSON.stringify([command.userId, command.targetStatus, command.expectedRevision]);
  return {
    async list(query, signal) { authorize(); await mockRead(options, 'admin.list', signal); return structuredClone(queryUsers(data, query)); },
    async readDetail(id, signal) { authorize(); await mockRead(options, 'admin.detail', signal); return structuredClone({ user: target(id), audit: data.audit.filter(a => a.targetUserId === id) }); },
    async changeStatus(command) {
      authorize();
      if (!command.operationId.trim() || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1 || !['active', 'disabled'].includes(command.targetStatus)) throw new RepositoryError('validation', 'Invalid mutation command');
      // Copy before the first await so callers cannot change a confirmed target in flight.
      const requested = structuredClone(command); const key = commandKey(requested);
      const replay = () => {
        const previous = operations.get(requested.operationId);
        if (previous && previous.command !== key) throw new RepositoryError('conflict', 'Operation ID already used for a different command');
        return previous ? { ...structuredClone(previous.result), replayed: true } : null;
      };
      const previous = replay(); if (previous) return previous;
      ++pending;
      try {
        await mockRead(options, 'admin.changeStatus');
        const concurrent = replay(); if (concurrent) return concurrent;
        const user = target(requested.userId);
        if (user.revision !== requested.expectedRevision) throw new RepositoryError('conflict', 'Account revision changed; read the latest state before retry');
        if (user.status === requested.targetStatus) {
          const result: MutationResult = { user: structuredClone(user), audit: null, replayed: false, sourceMode: 'mock' };
          operations.set(requested.operationId, { command: key, result }); return structuredClone(result);
        }
        const occurredAt = options.clock.now().toISOString(); const fromStatus = user.status;
        user.status = requested.targetStatus; user.revision++;
        const audit = { id: `audit-${requested.operationId}`, operationId: requested.operationId, actorId: principal.id, targetUserId: user.id,
          fromStatus, toStatus: user.status, occurredAt, sourceMode: 'mock' as const };
        data.audit = [...data.audit, audit];
        const result: MutationResult = { user: structuredClone(user), audit, replayed: false, sourceMode: 'mock' };
        operations.set(requested.operationId, { command: key, result: structuredClone(result) });
        if (options.timeoutAfterApply) throw new RepositoryError('timeout', 'Mock response lost after apply; refetch and retry using the same operation ID');
        return structuredClone(result);
      } finally { --pending; }
    },
    reset() {
      authorize();
      if (pending) throw new RepositoryError('conflict', 'Wait for pending demo mutations before reset');
      data = structuredClone(original); operations.clear();
    },
  };
}

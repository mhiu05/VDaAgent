import type { Clock, Page, Principal } from '../../reports/index';

export type AccountStatus = 'active' | 'disabled';
export interface ManagedUser {
  id: string; name: string; email: string; role: 'USER'; status: AccountStatus;
  createdAt: string; lastActiveAt: string | null; revision: number;
}
export interface AdminAuditEvent {
  id: string; operationId: string; actorId: string; targetUserId: string;
  fromStatus: AccountStatus; toStatus: AccountStatus; occurredAt: string; sourceMode: 'mock' | 'api';
}
export interface AdminDataset { users: readonly ManagedUser[]; audit: readonly AdminAuditEvent[] }
export interface AdminQuery {
  q: string; statuses: readonly AccountStatus[]; sort: 'name' | 'createdAt' | 'lastActiveAt'; direction: 'asc' | 'desc';
  page: number; pageSize: 25 | 50 | 100; user?: string;
}
export interface ChangeStatus {
  userId: string; targetStatus: AccountStatus; expectedRevision: number; operationId: string;
}
export interface MutationResult { user: ManagedUser; audit: AdminAuditEvent | null; replayed: boolean; sourceMode: 'mock' | 'api' }
export interface AdminDetail { user: ManagedUser; audit: AdminAuditEvent[] }
export interface AdminUsersRepository {
  list(query: AdminQuery, signal?: AbortSignal): Promise<Page<ManagedUser>>;
  readDetail(id: string, signal?: AbortSignal): Promise<AdminDetail>;
  changeStatus(command: ChangeStatus): Promise<MutationResult>;
  /** In-memory demo reset; no production persistence implied. */
  reset(): void;
}
export interface AdminMockOptions {
  principal: Principal; clock: Clock;
  latencyMs?: number | ((operation: string) => number);
  fail?: (operation: string) => Error | undefined;
  /** Reproducible unknown-outcome response, applied once per operation ID. */
  timeoutAfterApply?: boolean;
}

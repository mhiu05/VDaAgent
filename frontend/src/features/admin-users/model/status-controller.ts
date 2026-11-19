import { RepositoryError } from '../../reports/index';
import type { ErrorCode } from '../../reports/index';
import type { AccountStatus, AdminDetail, AdminUsersRepository, ChangeStatus, ManagedUser, MutationResult } from './types';

export type StatusChangeState =
  | { state: 'idle' }
  | { state: 'confirming'; target: ManagedUser; command: ChangeStatus }
  | { state: 'pending'; target: ManagedUser; command: ChangeStatus }
  | { state: 'success'; result: MutationResult }
  | { state: 'error'; target: ManagedUser; command: ChangeStatus; error: { code: ErrorCode | 'unknown'; message: string }; latest: AdminDetail | null };

/** Confirmation/pending/reconciliation logic that the future shared dialog can consume. */
export function createStatusController(repository: Pick<AdminUsersRepository, 'readDetail' | 'changeStatus'>, operationId: () => string) {
  let state: StatusChangeState = { state: 'idle' };
  let inFlight: Promise<StatusChangeState> | null = null;
  const snapshot = () => structuredClone(state);
  async function apply(target: ManagedUser, command: ChangeStatus): Promise<StatusChangeState> {
    state = { state: 'pending', target, command };
    try { state = { state: 'success', result: await repository.changeStatus(command) }; }
    catch (error) {
      // A missing response is not evidence that the mutation was not applied.
      let latest: AdminDetail | null = null;
      try { latest = await repository.readDetail(command.userId); } catch { /* Outcome remains unknown. */ }
      const audit = latest?.audit.find(a => a.operationId === command.operationId && a.toStatus === command.targetStatus);
      if (latest && audit) state = { state: 'success', result: { user: latest.user, audit, replayed: true, sourceMode: 'mock' } };
      else state = { state: 'error', target, command, error: { code: error instanceof RepositoryError ? error.code : 'unknown', message: error instanceof Error ? error.message : 'Unknown mutation outcome' }, latest };
    }
    return snapshot();
  }
  function submit(target: ManagedUser, command: ChangeStatus) {
    inFlight = apply(target, command).finally(() => { inFlight = null; }); return inFlight;
  }
  return {
    getState: snapshot,
    request(target: ManagedUser, targetStatus: AccountStatus) {
      if (inFlight) throw new RepositoryError('conflict', 'A confirmed operation is pending');
      state = { state: 'confirming', target: structuredClone(target), command: { userId: target.id, targetStatus, expectedRevision: target.revision, operationId: operationId() } };
      return snapshot();
    },
    cancel() { if (!inFlight) state = { state: 'idle' }; return snapshot(); },
    confirm(): Promise<StatusChangeState> {
      if (inFlight) return inFlight;
      if (state.state !== 'confirming') return Promise.reject(new RepositoryError('validation', 'Confirmation is required'));
      return submit(state.target, state.command);
    },
    retry(): Promise<StatusChangeState> {
      if (inFlight) return inFlight;
      if (state.state !== 'error') return Promise.reject(new RepositoryError('validation', 'No failed operation to retry'));
      if (state.error.code === 'conflict') return Promise.reject(new RepositoryError('conflict', 'Review the latest account and confirm a new operation'));
      // Preserve operation identity on an uncertain outcome; never silently change expected revision.
      return submit(state.target, state.command);
    },
  };
}

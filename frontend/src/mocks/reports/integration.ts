import type { Principal } from '../../shared/contracts/auth';
import type { ServiceResult } from '../../shared/contracts/service-result';
import { failure } from '../../shared/contracts/service-result';
import type { MockContext } from '../core/scenarios';
import { ids } from '../core/ids';
import { RepositoryError } from '../../features/reports/model/types';
import { demoUser } from './fixtures';

export function scopedPrincipal(principal: Principal, role: 'USER' | 'ADMIN', reportIds: readonly string[] = demoUser.reportIds) {
  if (principal.role !== role || principal.id !== (role === 'USER' ? ids.user : ids.admin)) throw new RepositoryError('forbidden', 'Principal outside demo scope');
  return { id: principal.id, role, projectIds: role === 'USER' ? demoUser.projectIds : [], reportIds: role === 'USER' ? reportIds : [] };
}
export async function serviceCall<T>(context: MockContext, operation: () => Promise<T>, signal?: AbortSignal): Promise<ServiceResult<T>> {
  signal?.throwIfAborted();
  try {
    await context.clock.sleep(context.scenario === 'loading' ? 1500 : 90, signal);
    if (context.scenario === 'offline' || !navigator.onLine) return failure('unavailable');
    return { data: await operation() };
  } catch (error) {
    signal?.throwIfAborted();
    const code = error instanceof RepositoryError ? error.code : 'unavailable';
    return failure(code, !['forbidden', 'notFound', 'validation'].includes(code));
  }
}

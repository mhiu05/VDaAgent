import type { Principal } from '../../../shared/contracts/auth';
import type { ServiceResult } from '../../../shared/contracts/service-result';
import type { Page } from '../../reports/model/types';
import type { AdminDetail, AdminQuery, ChangeStatus, ManagedUser, MutationResult } from '../model/types';
export interface AdminUsersService {
  list(principal: Principal, query: AdminQuery, signal?: AbortSignal): Promise<ServiceResult<Page<ManagedUser>>>;
  detail(principal: Principal, id: string, signal?: AbortSignal): Promise<ServiceResult<AdminDetail>>;
  changeStatus(principal: Principal, command: ChangeStatus): Promise<ServiceResult<MutationResult>>;
  reset(principal: Principal): Promise<ServiceResult<null>>;
}

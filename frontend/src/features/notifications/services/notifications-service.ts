import type { Notification } from "../model/types";
import type { ServiceResult } from "../../../shared/contracts/service-result";
export interface NotificationsService {
  list(id: string): Promise<ServiceResult<Notification[]>>;
  snapshot(id: string): readonly Notification[];
  subscribe(listener: () => void): () => void;
  markRead(
    id: string,
    notificationId?: string,
  ): Promise<ServiceResult<Notification[]>>;
  reset(id: string): void;
  readonly pending: boolean;
}

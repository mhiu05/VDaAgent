import type { AuthService } from '../../features/auth/services/auth-service';
import type { ChatService } from '../../features/chat/services/chat-service';
import type { NotificationsService } from '../../features/notifications/services/notifications-service';
import type { PreferencesService } from '../../features/settings/services/preferences-service';

/** Application dependencies. Implementations and transport details stay at bootstrap. */
export interface Services {
  context: { clock: { now(): Date; sleep(ms: number, signal?: AbortSignal): Promise<void> } };
  auth: AuthService;
  preferences: PreferencesService;
  chat: ChatService;
  notifications: NotificationsService;
  reportTargets: { hasReport(id: string): boolean };
  workspace: Record<string, unknown>;
}

import type { Notification } from "../../features/notifications/model/types";
import type { NotificationsService } from "../../features/notifications/services/notifications-service";
import { failure } from "../../shared/contracts/service-result";
import type { ApiClient } from "./http";
import type { Realtime } from "./realtime";
import { call } from "./result";

/** Shared so `snapshot` is referentially stable before the first load (`useSyncExternalStore`). */
const EMPTY: Notification[] = [];

/** Inbox at `/api/notifications` (doc 19); live updates from `notification.created|read`. */
export function createApiNotifications(client: ApiClient, realtime: Realtime, now: () => Date): NotificationsService {
  const scopes = new Map<string, Notification[]>();
  const listeners = new Set<() => void>();
  let pending = false;
  let live = false;
  let active: string | null = null;
  let revision = 0;
  const emit = () => listeners.forEach((l) => l());
  const update = (fn: (list: Notification[]) => Notification[]) => {
    if (active) scopes.set(active, fn(scopes.get(active) ?? EMPTY));
    emit();
  };
  function follow() {
    if (live) return;
    live = true;
    realtime.on("notification.created", (data) => {
      const n = data as Notification;
      update((list) => [n, ...list.filter((x) => x.id !== n.id)]);
    });
    realtime.on("notification.read", (data) => {
      const { ids, all } = data as { ids?: string[]; all?: boolean };
      const at = now().toISOString();
      update((list) => list.map((n) => !n.readAt && (all || ids?.includes(n.id)) ? { ...n, readAt: at } : n));
    });
  }
  return {
    get pending() { return pending; },
    snapshot: (id) => scopes.get(id) ?? EMPTY,
    subscribe(listener) {
      follow();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async list(id) {
      if (id !== active) {
        active = id;
        revision++;
        pending = false;
        scopes.clear();
      }
      const version = revision;
      const result = await call(() => client.get<Notification[]>("/api/notifications", { limit: 100 }));
      if (version !== revision) return failure("unavailable");
      if (result.data) { scopes.set(id, result.data); emit(); return { data: [...result.data] }; }
      return result;
    },
    async markRead(id, notificationId) {
      if (pending || id !== active) return failure("unavailable");
      const version = revision;
      const before = scopes.get(id) ?? EMPTY;
      const at = now().toISOString();
      pending = true;
      scopes.set(id, before.map((n) => !n.readAt && (!notificationId || n.id === notificationId) ? { ...n, readAt: at } : n));
      emit();
      const result = await call(() => client.post<Notification[]>("/api/notifications/read",
        notificationId ? { ids: [notificationId] } : {}));
      if (version !== revision) return failure("unavailable");
      pending = false;
      if (result.error) { scopes.set(id, before); emit(); return failure("saveError"); }
      scopes.set(id, result.data);
      emit();
      return { data: [...result.data] };
    },
    reset(id) {
      scopes.delete(id);
      if (active === id) { active = null; revision++; pending = false; }
      emit();
    },
  };
}

import type { NotificationsService } from "../../features/notifications/services/notifications-service";
import type { Notification } from "../../features/notifications/model/types";
import type { MockContext } from "../core/scenarios";
import { failure } from "../../shared/contracts/service-result";
import { makeNotifications } from "./fixtures";
function isReadMap(v: unknown): v is Record<string, string> {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.values(v).every(
      (x) => typeof x === "string" && Number.isFinite(Date.parse(x)),
    )
  );
}
export function createNotificationsMockService(
  ctx: MockContext,
): NotificationsService {
  const scopes = new Map<string, Notification[]>();
  const listeners = new Set<() => void>();
  let pending = false;
  const emit = () => listeners.forEach((l) => l());
  const snapshot = (id: string) => {
    if (!scopes.has(id)) {
      const reads = ctx.storage.get(id, "notification-reads", isReadMap) ?? {};
      scopes.set(
        id,
        ctx.scenario === "empty"
          ? []
          : makeNotifications().map((n) => ({
              ...n,
              readAt: reads[n.id] ?? n.readAt,
            })),
      );
    }
    return scopes.get(id)!;
  };
  return {
    get pending() {
      return pending;
    },
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async list(id) {
      await ctx.clock.sleep(ctx.scenario === "loading" ? 1200 : 30);
      if (ctx.scenario === "offline") return failure("offline");
      return { data: [...snapshot(id)] };
    },
    async markRead(id, nid) {
      if (pending) return failure("unavailable");
      const before = snapshot(id);
      pending = true;
      scopes.set(
        id,
        before.map((n) =>
          !n.readAt && (!nid || n.id === nid)
            ? { ...n, readAt: ctx.clock.now().toISOString() }
            : n,
        ),
      );
      emit();
      await ctx.clock.sleep(180);
      pending = false;
      if (ctx.scenario === "error" || ctx.scenario === "offline") {
        scopes.set(id, before);
        emit();
        return failure("saveError");
      }
      const after = snapshot(id);
      ctx.storage.set(
        id,
        "notification-reads",
        Object.fromEntries(
          after.filter((n) => n.readAt).map((n) => [n.id, n.readAt]),
        ),
      );
      emit();
      return { data: [...after] };
    },
    reset(id) {
      scopes.delete(id);
      ctx.storage.remove(id, "notification-reads");
      emit();
    },
  };
}

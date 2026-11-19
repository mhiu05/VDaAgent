import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useServices } from "../../../app/providers/ServicesProvider";
import { useAuth } from "../../auth/providers/AuthProvider";
import type { Notification } from "../model/types";
interface Value {
  items: readonly Notification[];
  loading: boolean;
  error: string;
  pending: boolean;
  reload(): void;
  markRead(id?: string): Promise<string | null>;
}
const Context = createContext<Value | null>(null);
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { notifications: service } = useServices();
  const { snapshot } = useAuth();
  const id = snapshot.status === "authenticated" ? snapshot.principal.id : "";
  const items = useSyncExternalStore(service.subscribe, () =>
    service.snapshot(id),
  );
  const pending = useSyncExternalStore(
    service.subscribe,
    () => service.pending,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void service.list(id).then((r) => {
      if (active) {
        setError(r.error?.messageKey ?? "");
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [id, service, attempt]);
  return (
    <Context.Provider
      value={{
        items,
        loading,
        error,
        pending,
        reload: () => setAttempt((a) => a + 1),
        markRead: async (nid) => {
          const r = await service.markRead(id, nid);
          return r.error?.messageKey ?? null;
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useNotifications() {
  const c = useContext(Context);
  if (!c) throw new Error("Missing NotificationsProvider");
  return c;
}
export function useUnreadCount() {
  const c = useContext(Context);
  return c?.items.filter((n) => !n.readAt).length ?? 0;
}

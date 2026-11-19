import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import type { AuthSnapshot } from "../../../shared/contracts/auth";
import type { DemoProfile } from "../services/auth-service";
import { useServices } from "../../../app/providers/ServicesProvider";
type AuthContextValue = {
  snapshot: AuthSnapshot;
  reason: string;
  restore(): Promise<void>;
  login(email: string, password: string): Promise<string | null>;
  loginAdminDemo(): Promise<string | null>;
  loginDemo(profile: DemoProfile): Promise<string | null>;
  logout(): void;
  /** Re-read the account status (provisioning → active/failed) without a full restore. */
  refreshStatus(): Promise<void>;
};
const Context = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth, context, chat, notifications } = useServices();
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({
    status: "checking",
  });
  const [reason, setReason] = useState("");
  const attempts = useRef(0);
  const invalidate = useCallback(() => { attempts.current++; }, []);
  const restore = useCallback(async () => {
    const attempt = ++attempts.current;
    setSnapshot({ status: "checking" });
    const r = await auth.restore();
    if (attempt !== attempts.current) return;
    if (r.error) {
      setReason(r.error.messageKey);
      setSnapshot({
        status: r.error.code === "expired" ? "anonymous" : "error",
      });
    } else
      setSnapshot(
        r.data
          ? { status: "authenticated", ...r.data }
          : { status: "anonymous" },
      );
  }, [auth]);
  useEffect(() => {
    void restore();
    return invalidate;
  }, [restore, invalidate]);
  useEffect(() => auth.onExpired?.(() => {
    attempts.current++;
    setReason("app:expired");
    setSnapshot({ status: "anonymous" });
  }), [auth]);
  const logout = useCallback(() => {
    attempts.current++;
    auth.logout();
    setSnapshot({ status: "anonymous" });
    setReason("");
  }, [auth]);
  useEffect(() => {
    if (snapshot.status !== "authenticated") return;
    const expire = () => {
      if (context.clock.now() >= new Date(snapshot.expiresAt)) {
        auth.logout();
        setReason("app:expired");
        setSnapshot({ status: "anonymous" });
      }
    };
    const timer = setInterval(expire, 1000);
    window.addEventListener("focus", expire);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", expire);
      chat.release(snapshot.principal.id);
    };
  }, [snapshot, auth, context.clock, chat]);
  const principalId = snapshot.status === "authenticated" ? snapshot.principal.id : null;
  useEffect(() => () => {
    if (principalId) notifications.reset(principalId);
  }, [principalId, notifications]);
  const refreshStatus = useCallback(async () => {
    if (!auth.accountStatus) return;
    const r = await auth.accountStatus();
    if (r.error) return; // transient: the next poll tries again
    if (r.data === null) {
      auth.logout();
      setReason("app:expired");
      setSnapshot({ status: "anonymous" });
      return;
    }
    const next = r.data;
    // a new object only on a change, so the session effects don't re-run on every poll
    setSnapshot((s) =>
      s.status === "authenticated" && s.accountStatus !== next
        ? { ...s, accountStatus: next }
        : s,
    );
  }, [auth]);
  async function login(email: string, password: string) {
    const attempt = ++attempts.current;
    const r = await auth.login(email, password);
    if (attempt !== attempts.current) return "app:expired";
    if (r.error) return r.error.messageKey;
    setReason("");
    setSnapshot({ status: "authenticated", ...r.data });
    return null;
  }
  async function loginAdminDemo() {
    const attempt = ++attempts.current;
    const r = await auth.loginAdminDemo();
    if (attempt !== attempts.current) return "app:expired";
    if (r.error) return r.error.messageKey;
    setReason("");
    setSnapshot({ status: "authenticated", ...r.data });
    return null;
  }
  async function loginDemo(profile: DemoProfile) {
    const attempt = ++attempts.current;
    const r = await auth.loginDemo(profile);
    if (attempt !== attempts.current) return "app:expired";
    if (r.error) return r.error.messageKey;
    setReason("");
    setSnapshot({ status: "authenticated", ...r.data });
    return null;
  }
  return (
    <Context.Provider
      value={{ snapshot, reason, restore, login, loginAdminDemo, loginDemo, logout, refreshStatus }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing AuthProvider");
  return value;
}

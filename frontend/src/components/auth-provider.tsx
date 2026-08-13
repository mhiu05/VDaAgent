"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSupabaseBrowserClient } from "@/lib/auth/client";
import { cleanupGuestSession, setApiAuthTransport } from "@/lib/api";
import { clearChatHistory, setChatHistoryScope } from "@/lib/chat-history";
import { clearGuestSession, getGuestSession, guestEnabled, startGuestSession, type GuestRole } from "@/lib/auth/guest-session";

export type Workspace = { id: string; name: string; slug: string; role: string };
export type Me = {
  user: { id: string; email: string | null };
  workspace: { id: string; role: string };
  effective_permissions: string[];
  workspaces: Workspace[];
};

type AuthValue = {
  me: Me | null;
  authenticated: boolean;
  isGuest: boolean;
  guestRole: GuestRole | null;
  loading: boolean;
  error: string | null;
  workspaceId: string | null;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  signOut: () => Promise<void>;
  enterGuestRole: (role: GuestRole) => Promise<void>;
  refresh: () => Promise<string | null>;
};

const AuthContext = createContext<AuthValue | null>(null);

function apiBase() {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  return `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
}

async function fetchSessionResource(url: string, headers: Headers): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, { headers, credentials: "include", cache: "no-store", signal: controller.signal });
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") {
      throw new Error("Không thể kết nối workspace trong 12 giây. Hãy kiểm tra backend đang chạy tại cổng 8000.");
    }
    throw reason;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [guestRole, setGuestRole] = useState<GuestRole | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadInFlight = useRef<Promise<void> | null>(null);
  const workspaceIdRef = useRef<string | null>(null);

  const supabaseAccessToken = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const accessToken = useCallback(async () => {
    const token = await supabaseAccessToken();
    if (token) return token;
    if (!guestEnabled()) return null;
    return (getGuestSession() ?? startGuestSession()).accessToken;
  }, [supabaseAccessToken]);

  const refresh = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return null;
    const { data, error: refreshError } = await client.auth.refreshSession();
    if (refreshError) return null;
    return data.session?.access_token ?? null;
  }, []);

  const load = useCallback((requestedWorkspace?: string | null) => {
    if (loadInFlight.current) return loadInFlight.current;

    const task = (async () => {
      setLoading(true);
      setError(null);
      try {
        const supabaseToken = await supabaseAccessToken();
        if (supabaseToken) {
          const staleGuest = getGuestSession();
          if (staleGuest) {
            await cleanupGuestSession(staleGuest.accessToken);
            clearGuestSession();
          }
        }
        const guestSession = !supabaseToken && guestEnabled() ? (getGuestSession() ?? startGuestSession()) : null;
        const token = supabaseToken ?? guestSession?.accessToken ?? null;
        const headers = new Headers({ Accept: "application/json" });
        if (token) headers.set("Authorization", `Bearer ${token}`);
        // Guest sessions have exactly one short-lived workspace. Avoid sending
        // a stale signed-in workspace id when a visitor starts a new trial.
        const saved = supabaseToken
          ? requestedWorkspace ?? window.localStorage.getItem("p170-workspace-id")
          : null;
        if (saved) headers.set("X-Workspace-Id", saved);
        const response = await fetchSessionResource(`${apiBase()}/session`, headers);
        if (!response.ok) throw new Error("Phiên đăng nhập không có quyền truy cập workspace.");
        const payload = await response.json() as Me;
        const selected = payload.workspace.id;
        workspaceIdRef.current = selected;
        setWorkspaceId(selected);
        window.localStorage.setItem("p170-workspace-id", selected);
        setMe(payload);
        setAuthenticated(Boolean(supabaseToken));
        setIsGuest(Boolean(guestSession));
        setGuestRole(guestSession?.role ?? null);
        setChatHistoryScope(payload.user.id, selected, Boolean(guestSession));
      } catch (reason) {
        setMe(null);
        setAuthenticated(false);
        workspaceIdRef.current = null;
        setWorkspaceId(null);
        setChatHistoryScope(null, null);
        setError(reason instanceof Error ? reason.message : "Không thể khởi tạo phiên đăng nhập.");
      } finally {
        setLoading(false);
      }
    })();
    loadInFlight.current = task;
    void task.finally(() => {
      if (loadInFlight.current === task) loadInFlight.current = null;
    });
    return task;
  }, [supabaseAccessToken]);

  useEffect(() => {
    setApiAuthTransport({ accessToken, workspaceId: () => workspaceIdRef.current, refresh });
    return () => setApiAuthTransport(null);
  }, [accessToken, refresh]);

  useEffect(() => {
    void load();
    const client = getSupabaseBrowserClient();
    if (!client) return;
    // Supabase invokes this callback while its internal auth lock is held.
    // Calling getSession() synchronously through load() from inside the
    // callback can deadlock guest mode (the client exists, but there is no
    // Supabase session). Defer the reload until the callback has returned.
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      window.setTimeout(() => { void load(workspaceIdRef.current); }, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [load]); // Session callback always reads fresh persisted workspace.

  const switchWorkspace = useCallback(async (nextWorkspaceId: string) => {
    if (nextWorkspaceId === workspaceId) return;
    await queryClient.cancelQueries();
    queryClient.clear();
    await load(nextWorkspaceId);
  }, [load, queryClient, workspaceId]);

  const signOut = useCallback(async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    const guestSession = getGuestSession();
    if (guestSession) {
      await cleanupGuestSession(guestSession.accessToken);
      clearChatHistory();
      clearGuestSession();
    }
    window.localStorage.removeItem("p170-workspace-id");
    setMe(null);
    setAuthenticated(false);
    setIsGuest(false);
    setGuestRole(null);
    workspaceIdRef.current = null;
    setWorkspaceId(null);
    setChatHistoryScope(null, null);
    await getSupabaseBrowserClient()?.auth.signOut();
    window.location.assign("/");
  }, [queryClient]);

  const enterGuestRole = useCallback(async (role: GuestRole) => {
    void queryClient.cancelQueries();
    queryClient.clear();
    const previous = getGuestSession();
    if (previous) {
      // Cleanup is best-effort. Do not make switching roles wait for the API.
      void cleanupGuestSession(previous.accessToken);
      clearChatHistory();
      clearGuestSession();
    }
    if (authenticated) await getSupabaseBrowserClient()?.auth.signOut();
    window.localStorage.removeItem("p170-workspace-id");
    startGuestSession(role);
    // Keep the app shell and AuthProvider alive. A client transition avoids a
    // full Next.js boot and lets the dashboard show its loading state at once.
    void load();
    router.push("/dashboard");
  }, [authenticated, load, queryClient, router]);

  const value = useMemo(() => ({ me, authenticated, isGuest, guestRole, loading, error, workspaceId, switchWorkspace, signOut, enterGuestRole, refresh }), [me, authenticated, isGuest, guestRole, loading, error, workspaceId, switchWorkspace, signOut, enterGuestRole, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth phải nằm trong AuthProvider.");
  return value;
}

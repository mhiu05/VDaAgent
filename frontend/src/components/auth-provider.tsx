"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clearSupabaseLocalSession, getSupabaseBrowserClient } from "@/lib/auth/client";
import { cleanupGuestSession, provisionSelfSignup, setApiAuthTransport } from "@/lib/api";
import { clearChatHistory, setChatHistoryScope } from "@/lib/chat-history";
import { clearGuestSession, getGuestSession, startGuestSession, type GuestRole } from "@/lib/auth/guest-session";
import { requestedSignupRole } from "@/lib/auth/onboarding";

export type Workspace = { id: string; name: string; slug: string; role: string; created_by_user_id?: string; is_project?: boolean };
export type Me = {
  user: { id: string; email: string | null };
  workspace: { id: string; role: string };
  effective_permissions: string[];
  workspaces: Workspace[];
};

type WorkspaceBootstrap = Me & {
  dashboard: {
    kind: "analyst";
    reports?: Array<{ id: string; title: string; status: string }>;
    counts?: Record<string, number>;
  };
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

function requiresWorkspaceBootstrap(pathname: string): boolean {
  if (pathname.startsWith("/account/update-password")) return false;
  return [
    "/dashboard",
    "/workspaces",
    "/reports",
    "/chat",
    "/datasets",
    "/profiles",
    "/charts",
    "/compare",
    "/activity",
    "/account",
    "/settings",
  ].some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function apiBase() {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  return `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
}

async function readWorkspaceError(response: Response): Promise<Error> {
  try {
    const body = await response.clone().json() as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail) return new Error(body.detail);
  } catch {
    // Keep the stable workspace error below when the response is not JSON.
  }
  return new Error("Phiên đăng nhập không có quyền truy cập workspace.");
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

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const pathnameRef = useRef(pathname);
  const [me, setMe] = useState<Me | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [guestRole, setGuestRole] = useState<GuestRole | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadInFlight = useRef<Promise<boolean> | null>(null);
  const workspaceIdRef = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const guestSwitchSequence = useRef(0);
  const bootstrapWatchdog = useRef<number | null>(null);
  // A role button is an explicit request to use the temporary guest
  // principal. Keep it separate from React state so it wins over an expired
  // Supabase session that may still be present in browser storage.
  const guestModeRef = useRef(false);

  const supabaseAccessToken = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return null;
    const { data } = await withTimeout(
      client.auth.getSession(),
      12_000,
      "Supabase không trả phiên đăng nhập trong 12 giây. Hãy tải lại trang và thử lại.",
    );
    return data.session?.access_token ?? null;
  }, []);

  const accessToken = useCallback(async () => {
    const guestSession = getGuestSession();
    if (guestModeRef.current && guestSession) return guestSession.accessToken;
    const token = await supabaseAccessToken();
    if (token) return token;
    if (guestSession) return guestSession.accessToken;
    return null;
  }, [supabaseAccessToken]);

  const refresh = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return null;
    try {
      const { data, error: refreshError } = await withTimeout(client.auth.refreshSession(), 12_000, "Supabase refresh timeout");
      if (refreshError) return null;
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  }, []);

  const resetUnauthenticatedState = useCallback(() => {
    setMe(null);
    setAuthenticated(false);
    setIsGuest(false);
    setGuestRole(null);
    workspaceIdRef.current = null;
    setWorkspaceId(null);
    setChatHistoryScope(null, null);
  }, []);

  const load = useCallback((requestedWorkspace?: string | null, force = false, preferGuest = false, background = false) => {
    if (loadInFlight.current && !force) return loadInFlight.current;

    const sequence = ++loadSequence.current;

    const task = (async () => {
      let sawSupabaseSession = false;
      // Only workspace routes require the protected bootstrap request. A
      // guest-role click is the one public-route exception: it explicitly
      // requests a temporary workspace before navigation completes.
      if (!preferGuest && !requiresWorkspaceBootstrap(pathnameRef.current)) {
        if (sequence !== loadSequence.current) return false;
        setError(null);
        setLoading(false);
        return false;
      }
      if (!background) {
        setLoading(true);
        setError(null);
      }
      try {
        const existingGuestSession = getGuestSession();
        const useGuestSession = preferGuest || (guestModeRef.current && Boolean(existingGuestSession));
        const supabaseToken = useGuestSession ? null : await supabaseAccessToken();
        if (supabaseToken) {
          sawSupabaseSession = true;
          if (sequence === loadSequence.current) {
            setAuthenticated(true);
            setIsGuest(false);
            setGuestRole(null);
          }
          guestModeRef.current = false;
          const staleGuest = getGuestSession();
          if (staleGuest) {
            // Cleanup must never block workspace bootstrap if the backend is
            // temporarily unavailable.
            void cleanupGuestSession(staleGuest.accessToken);
            clearGuestSession();
          }
        }
        // A trial starts only after an explicit role selection. This prevents
        // a new guest workspace from being recreated immediately after the
        // visitor ends a trial session.
        const guestSession = !supabaseToken ? existingGuestSession : null;
        const token = supabaseToken ?? guestSession?.accessToken ?? null;
        // A private route can be opened directly before the visitor has
        // signed in or selected a guest role. Do not send an anonymous
        // request to /session: it is guaranteed to return 401 and causes
        // every protected page mounted underneath the shell to repeat it.
        if (!token) {
          if (sequence !== loadSequence.current) return false;
          resetUnauthenticatedState();
          setError(null);
          return false;
        }
        const headers = new Headers({ Accept: "application/json" });
        let tokenForRequest = token;
        headers.set("Authorization", `Bearer ${tokenForRequest}`);
        // Guest sessions have exactly one short-lived workspace. Avoid sending
        // a stale signed-in workspace id when a visitor starts a new trial.
        const saved = supabaseToken
          ? requestedWorkspace ?? window.localStorage.getItem("p170-workspace-id")
          : null;
        if (saved) headers.set("X-Workspace-Id", saved);
        let response = await fetchSessionResource(`${apiBase()}/workspace-bootstrap`, headers);
        // Supabase can return a locally cached token that has just expired.
        // Refresh it once at the auth boundary, then let the normal error
        // state handle a genuinely invalid or revoked session.
        if (!response.ok && response.status === 401 && supabaseToken) {
          const refreshed = await refresh();
          if (refreshed && refreshed !== supabaseToken) {
            tokenForRequest = refreshed;
            headers.set("Authorization", `Bearer ${tokenForRequest}`);
            response = await fetchSessionResource(`${apiBase()}/workspace-bootstrap`, headers);
          }
        }
        // A workspace id is persisted for convenience, but it may belong to a
        // previous account or have been removed. Retry without it before
        // treating the session as unauthorized.
        if (!response.ok && response.status === 404 && saved) {
          headers.delete("X-Workspace-Id");
          response = await fetchSessionResource(`${apiBase()}/workspace-bootstrap`, headers);
        }
        // Supabase Auth users can exist without an application workspace when
        // they were created from the Supabase dashboard or an older signup
        // flow. Provision the idempotent personal workspace once, then retry
        // the normal session lookup. Guest sessions are excluded because the
        // backend creates their temporary workspace itself.
        if (!response.ok && response.status === 403 && supabaseToken) {
          const client = getSupabaseBrowserClient();
          const { data: sessionData } = client
            ? await withTimeout(client.auth.getSession(), 12_000, "Supabase không trả phiên đăng nhập trong 12 giây.")
            : { data: { session: null } };
          const role = requestedSignupRole(sessionData.session?.user.user_metadata?.requested_role);
          // `refreshSession()` can rotate the browser token while the
          // workspace request is in flight. Provision with that current token
          // instead of the original (possibly rejected) bearer value.
          const tokenForProvision = sessionData.session?.access_token ?? tokenForRequest;
          if (!tokenForProvision) throw new Error("Missing active access token.");
          tokenForRequest = tokenForProvision;
          headers.set("Authorization", `Bearer ${tokenForRequest}`);
          await provisionSelfSignup(role, tokenForProvision);
          if (sequence !== loadSequence.current) return false;
          response = await fetchSessionResource(`${apiBase()}/workspace-bootstrap`, headers);
        }
        // A guest can change role while this request is in flight. Ignore the
        // old response instead of allowing it to replace the newer workspace.
        if (sequence !== loadSequence.current) return false;
        if (!response.ok && response.status === 401) {
          // A rejected bearer must not remain in browser storage. Keeping it
          // would make every protected route bootstrap retry /session (and,
          // for a new user, /onboarding/provision) with the same bad token.
          if (supabaseToken) {
            // Do not call Supabase logout here: an expired token can make the
            // logout endpoint return another noisy 403. Local cleanup is
            // sufficient and prevents the rejected bearer from being reused.
            clearSupabaseLocalSession();
          } else if (guestSession) {
            clearGuestSession();
          }
          window.localStorage.removeItem("p170-workspace-id");
          resetUnauthenticatedState();
          setError(null);
          if (supabaseToken) router.replace("/login?reason=session_expired");
          return false;
        }
        if (!response.ok) throw await readWorkspaceError(response);
        const payload = await response.json() as WorkspaceBootstrap;
        const selected = payload.workspace.id;
        queryClient.setQueryData(["dashboard", selected], payload.dashboard);
        workspaceIdRef.current = selected;
        setWorkspaceId(selected);
        window.localStorage.setItem("p170-workspace-id", selected);
        setMe(payload);
        setAuthenticated(Boolean(supabaseToken));
        setIsGuest(Boolean(guestSession));
        setGuestRole(guestSession?.role ?? null);
        setChatHistoryScope(payload.user.id, selected, Boolean(guestSession));
        return true;
      } catch (reason) {
        if (sequence !== loadSequence.current) return false;
        // A background revalidation must not blank a workspace because of a
        // transient network/auth refresh failure. The next API request can
        // still refresh the token through the shared auth transport.
        if (background && workspaceIdRef.current) return false;
        if (sawSupabaseSession) {
          setError(reason instanceof Error ? reason.message : String(reason));
          return false;
        }
        resetUnauthenticatedState();
        setError(reason instanceof Error ? reason.message : "Không thể khởi tạo phiên đăng nhập.");
        return false;
      } finally {
        if (!background && sequence === loadSequence.current) setLoading(false);
      }
    })();
    loadInFlight.current = task;
    void task.finally(() => {
      if (loadInFlight.current === task) loadInFlight.current = null;
    });
    return task;
  }, [queryClient, refresh, resetUnauthenticatedState, router, supabaseAccessToken]);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    setApiAuthTransport({ accessToken, workspaceId: () => workspaceIdRef.current, refresh });
    return () => setApiAuthTransport(null);
  }, [accessToken, refresh]);

  // A browser auth lock, an unreachable Supabase endpoint, or a stalled API
  // must never leave the whole workspace shell in a permanent loading state.
  useEffect(() => {
    if (!loading) return;
    bootstrapWatchdog.current = window.setTimeout(() => {
      if (!loading) return;
      ++loadSequence.current;
      loadInFlight.current = null;
      setMe(null);
      setAuthenticated(false);
      workspaceIdRef.current = null;
      setWorkspaceId(null);
      setError("Không thể xác định phiên và workspace trong 20 giây. Hãy tải lại trang để thử lại.");
      setLoading(false);
    }, 20_000);
    return () => {
      if (bootstrapWatchdog.current !== null) window.clearTimeout(bootstrapWatchdog.current);
      bootstrapWatchdog.current = null;
    };
  }, [loading]);

  useEffect(() => {
    // Bootstrap only pages that actually consume workspace-scoped resources.
    // This avoids both protected requests and loading UI across all public,
    // auth and future standalone pages.
    if (!requiresWorkspaceBootstrap(pathname)) {
      setLoading(false);
      setError(null);
      return;
    }
    // A workspace is retained in this provider while users move between
    // workspace routes. Reusing it avoids a second auth/API round trip and,
    // crucially, prevents the global shell from entering its blocking loading
    // state on every tab click.
    if (!workspaceIdRef.current) void load();
    const heartbeat = window.setInterval(() => {
      if (workspaceIdRef.current) void load(workspaceIdRef.current, false, false, true);
    }, 60_000);
    const client = getSupabaseBrowserClient();
    if (!client) return () => window.clearInterval(heartbeat);
    // Supabase invokes this callback while its internal auth lock is held.
    // Calling getSession() synchronously through load() from inside the
    // callback can deadlock guest mode (the client exists, but there is no
    // Supabase session). Defer the reload until the callback has returned.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      // Supabase refreshes the access token when a background tab becomes
      // active. The API transport reads the fresh token on demand, so a token
      // refresh does not require rebuilding the workspace shell.
      if (event === "INITIAL_SESSION") {
        if (session?.access_token && !guestModeRef.current) {
          // Session restoration and the first workspace request can complete
          // in either order after a full navigation. Treat the Supabase
          // session as authenticated immediately; workspace data may continue
          // loading without changing the public navbar into a signed-out one.
          setAuthenticated(true);
          setIsGuest(false);
          setGuestRole(null);
          window.setTimeout(() => {
            if (
              !workspaceIdRef.current
              && !loadInFlight.current
              && requiresWorkspaceBootstrap(pathnameRef.current)
            ) {
              void load(null, true);
            }
          }, 0);
        }
        return;
      }
      if (
        event === "TOKEN_REFRESHED"
        || !requiresWorkspaceBootstrap(pathnameRef.current)
      ) return;
      if (event === "SIGNED_OUT") {
        ++loadSequence.current;
        loadInFlight.current = null;
        setMe(null);
        setAuthenticated(false);
        setIsGuest(false);
        setGuestRole(null);
        workspaceIdRef.current = null;
        setWorkspaceId(null);
        setError(null);
        setLoading(false);
        setChatHistoryScope(null, null);
        return;
      }
      window.setTimeout(() => {
        const preferGuest = guestModeRef.current;
        const hasActiveWorkspace = Boolean(workspaceIdRef.current);
        void load(
          preferGuest ? null : workspaceIdRef.current,
          preferGuest,
          preferGuest,
          hasActiveWorkspace,
        );
      }, 0);
    });
    return () => {
      window.clearInterval(heartbeat);
      data.subscription.unsubscribe();
    };
  }, [load, pathname]); // Re-bootstrap only when crossing into a workspace route.

  const switchWorkspace = useCallback(async (nextWorkspaceId: string) => {
    if (nextWorkspaceId === workspaceId) return;
    await queryClient.cancelQueries();
    queryClient.clear();
    await load(nextWorkspaceId, true);
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
    guestModeRef.current = false;
    await getSupabaseBrowserClient()?.auth.signOut();
    window.location.assign("/");
  }, [queryClient]);

  const enterGuestRole = useCallback(async (role: GuestRole) => {
    const switchSequence = ++guestSwitchSequence.current;
    guestModeRef.current = true;
    void queryClient.cancelQueries();
    queryClient.clear();
    // The initial auth bootstrap may still be resolving when a visitor picks
    // a trial role from the public navbar. Start the new role immediately;
    // load() sequence checks below will ignore any older response instead of
    // making the click wait for a slow or stalled request.
    if (switchSequence !== guestSwitchSequence.current) return;
    const previous = getGuestSession();
    if (previous) {
      // Cleanup is best-effort. Do not make switching roles wait for the API.
      void cleanupGuestSession(previous.accessToken);
      clearChatHistory();
      clearGuestSession();
    }
    // The page may look signed out while Supabase still holds an expired
    // token. Clear it regardless, otherwise that token can be chosen before
    // the new guest token and the backend returns 401.
    clearSupabaseLocalSession();
    if (switchSequence !== guestSwitchSequence.current) return;
    window.localStorage.removeItem("p170-workspace-id");
    startGuestSession(role);
    // Enter the workspace immediately. Its shell shows the loading state while
    // the fresh role/session resolves, so a slow backend cannot make a navbar
    // click appear to do nothing.
    void load(null, true, true);
    if (switchSequence === guestSwitchSequence.current) router.push("/workspaces");
  }, [authenticated, load, queryClient, router]);

  const value = useMemo(() => ({ me, authenticated, isGuest, guestRole, loading, error, workspaceId, switchWorkspace, signOut, enterGuestRole, refresh }), [me, authenticated, isGuest, guestRole, loading, error, workspaceId, switchWorkspace, signOut, enterGuestRole, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth phải nằm trong AuthProvider.");
  return value;
}

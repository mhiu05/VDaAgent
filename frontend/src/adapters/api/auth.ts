import type { AuthService, DemoOptions } from "../../features/auth/services/auth-service";
import type { AccountStatus, Principal, Session, SessionDomain } from "../../shared/contracts/auth";
import { isPreferences, type Preferences } from "../../shared/contracts/preferences";
import { failure } from "../../shared/contracts/service-result";
import { ApiRequestError, type ApiClient } from "./http";
import type { Realtime } from "./realtime";
import type { SessionStore } from "./session";

/** `Me` of doc 15. */
export interface MeDto {
  id: string; username: string; display_name: string; role: "user" | "admin";
  domain: SessionDomain | null; status: AccountStatus;
}

/** The API session slides (doc 12), so `expiresAt` is a horizon; a 401 ends the session. */
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

export function principalOf(me: MeDto): Principal {
  return { id: me.id, displayName: me.display_name || me.username, email: me.username,
    role: me.role === "admin" ? "ADMIN" : "USER" };
}

/** `realtime` is restarted when the session changes: `/api/stream` stays bound to the user who
 * opened it, so after logout → login as someone else the old stream would carry the old user's
 * events and none of the new user's replies. */
export function createApiAuth(client: ApiClient, session: SessionStore, now: () => Date,
  realtime?: Pick<Realtime, "restart">): AuthService {
  let generation = 0;
  function current(version: number) {
    if (version !== generation) throw new ApiRequestError(401, "session_changed");
  }
  async function adopt(me: MeDto, version: number): Promise<Session> {
    current(version);
    const principal = principalOf(me);
    session.principal = principal;
    session.domain = me.domain;
    session.preferences = null;
    if (principal.role === "USER") {
      try {
        const prefs = await client.get<Preferences>("/api/me/preferences");
        if (session.principal === principal) session.preferences = isPreferences(prefs) ? prefs : null;
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) throw error;
        if (session.principal === principal) session.preferences = null;
      }
    }
    current(version);
    if (session.principal !== principal) throw new ApiRequestError(401, "session_changed");
    return { principal, domain: me.domain, accountStatus: me.status,
      expiresAt: new Date(now().getTime() + HORIZON_MS).toISOString() };
  }
  return {
    onExpired: (listener) => session.onExpired(listener),
    demoAccounts: [],
    async demoOptions() {
      try {
        return { data: await client.get<DemoOptions>("/api/auth/demo/options") };
      } catch { return failure("unavailable"); }
    },
    async loginAdminDemo() {
      const version = ++generation;
      try {
        const me = await client.post<MeDto>("/api/auth/demo/admin");
        current(version);
        realtime?.restart();
        return { data: await adopt(me, version) };
      } catch { return failure("unavailable"); }
    },
    async loginDemo(profile) {
      const version = ++generation;
      try {
        const me = await client.post<MeDto>("/api/auth/demo-login", { profile });
        current(version);
        realtime?.restart();
        return { data: await adopt(me, version) };
      } catch (error) {
        if (error instanceof ApiRequestError && error.serverCode === "demo_admin_unavailable") {
          return failure("demoAdminUnavailable", false);
        }
        return failure("demoLoginFailed");
      }
    },
    async restore() {
      const version = ++generation;
      try {
        return { data: await adopt(await client.get<MeDto>("/api/auth/me"), version) };
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) return { data: null };
        return failure("unavailable");
      }
    },
    async login(email, password) {
      const version = ++generation;
      try {
        const me = await client.post<MeDto>("/api/auth/login",
          { username: email.trim().toLowerCase(), password });
        current(version);
        realtime?.restart(); // the session cookie is set: reopen the stream as this user
        return { data: await adopt(me, version) };
      } catch (error) {
        if (error instanceof ApiRequestError) {
          if (error.status === 401) return failure("credentials", false);
          if (error.status === 403) return failure("forbidden", false);
          if (error.status === 429) return failure("rateLimited", true);
        }
        return failure("unavailable");
      }
    },
    logout() {
      generation++;
      session.clear();
      // only once the server dropped the session, or the new stream would reopen as this user
      void client.post("/api/auth/logout").catch(() => undefined).finally(() => realtime?.restart());
    },
    async accountStatus() {
      try {
        return { data: (await client.get<MeDto>("/api/auth/me")).status };
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) return { data: null };
        return failure("unavailable");
      }
    },
  };
}

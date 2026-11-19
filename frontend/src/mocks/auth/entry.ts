import type { AuthService } from "../../features/auth/services/auth-service";
import type { Session } from "../../shared/contracts/auth";
import { failure } from "../../shared/contracts/service-result";
import type { MockContext } from "../core/scenarios";
import { accounts, demoAdmin } from "./fixtures";
export function isSession(v: unknown): v is Session {
  if (!v || typeof v !== "object") return false;
  const s = v as Session;
  return (
    !!s.principal &&
    typeof s.principal.id === "string" &&
    typeof s.principal.email === "string" &&
    typeof s.principal.displayName === "string" &&
    ["USER", "ADMIN"].includes(s.principal.role) &&
    (s.domain === null ||
      (typeof s.domain === "object" &&
        typeof s.domain.id === "string" &&
        ["available", "unavailable"].includes(s.domain.status))) &&
    Number.isFinite(Date.parse(s.expiresAt))
  );
}
export function createAuthMockService(ctx: MockContext): AuthService {
  function establish(principal: Session["principal"]): Session {
    const session = {
      principal,
      domain: null,
      expiresAt: new Date(ctx.clock.now().getTime() + 8 * 60 * 60 * 1000).toISOString(),
    };
    ctx.storage.set("public", "session", session);
    return session;
  }
  return {
    demoAccounts: accounts.map((a) => ({
      role: a.principal.role,
      email: a.principal.email,
      password: a.password,
    })),
    async demoOptions() {
      return { data: { available: ["admin", "vre-demo", "alice"] } };
    },
    async loginDemo(profile) {
      await ctx.clock.sleep(ctx.scenario === "loading" ? 1500 : 250);
      if (ctx.scenario === "error" || ctx.scenario === "offline") return failure("demoLoginFailed");
      if (profile === "admin") return { data: establish(demoAdmin) };
      return { data: establish({
        id: profile === "alice" ? "demo-alice" : "demo-vre",
        displayName: profile === "alice" ? "Alice" : "VRE Demo",
        email: profile,
        role: "USER",
      }) };
    },
    async loginAdminDemo() {
      await ctx.clock.sleep(ctx.scenario === "loading" ? 1500 : 250);
      if (ctx.scenario === "error" || ctx.scenario === "offline") return failure("unavailable");
      return { data: establish(demoAdmin) };
    },
    async restore() {
      const s = ctx.storage.get("public", "session", isSession);
      if (
        ctx.scenario === "expired-session" ||
        (s && new Date(s.expiresAt) <= ctx.clock.now())
      ) {
        ctx.storage.remove("public", "session");
        return failure("expired", false);
      }
      return { data: s };
    },
    async login(email, password) {
      await ctx.clock.sleep(ctx.scenario === "loading" ? 1500 : 250);
      if (ctx.scenario === "error" || ctx.scenario === "offline")
        return failure("unavailable");
      const a = accounts.find(
        (a) =>
          a.principal.email === email.trim().toLowerCase() &&
          a.password === password,
      );
      if (!a) return failure("credentials", false);
      return { data: establish(a.principal) };
    },
    logout() {
      ctx.storage.remove("public", "session");
    },
  };
}

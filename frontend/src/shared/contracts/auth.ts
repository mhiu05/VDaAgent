export type Role = "USER" | "ADMIN";
export interface Principal {
  id: string;
  displayName: string;
  email: string;
  role: Role;
}
export interface SessionDomain {
  id: string;
  name: string;
  status: "available" | "unavailable";
}
/** `users.status` (doc 12): only the API sets it; absent means a ready account (mock mode). */
export type AccountStatus = "provisioning" | "active" | "failed" | "disabled";
export interface Session {
  principal: Principal;
  domain: SessionDomain | null;
  expiresAt: string;
  accountStatus?: AccountStatus;
}
export type AuthSnapshot =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "error" }
  | ({ status: "authenticated" } & Session);
/** Landing route (doc 14 "Routes"): on the API a user lands on /chat and an admin on /admin;
 * the mock runtime keeps its documented demo landing. */
export const homeFor = (role: Role, api: boolean) =>
  role === "ADMIN" ? (api ? "/admin" : "/admin/users") : api ? "/chat" : "/";

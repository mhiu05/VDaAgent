import type { ComponentType } from "react";
import type { Role } from "./auth";
export type FeatureId =
  | "dashboard"
  | "reports"
  | "chat"
  | "groups"
  | "notifications"
  | "settings"
  | "agents"
  | "admin"
  | "admin-users"
  | "admin-domains";
export type IconKey =
  | "dashboard"
  | "reports"
  | "chat"
  | "notifications"
  | "settings"
  | "users"
  | "agents"
  | "overview"
  | "domains";
export type LocaleMessages = {
  vi: Record<string, string>;
  en: Record<string, string>;
};
export interface FeatureRegistration {
  id: FeatureId;
  path: string;
  detailPaths?: readonly string[];
  role: Role;
  layout: "user" | "admin";
  frame: "page" | "viewport";
  loadPage: () => Promise<{ default: ComponentType }>;
  navigation: { labelKey: string; iconKey: IconKey; order: number };
  /** A workspace service key; without it the feature is left out of navigation. */
  requires?: string;
}
const routes: Record<FeatureId, string> = {
  dashboard: "/",
  reports: "/reports",
  chat: "/chat",
  groups: "/groups",
  notifications: "/notifications",
  settings: "/setting",
  agents: "/agents",
  admin: "/admin",
  "admin-users": "/admin/users",
  "admin-domains": "/admin/domains",
};
const adminFeatures: readonly FeatureId[] = ["admin", "admin-users", "admin-domains"];
const detailPaths: Partial<Record<FeatureId, readonly string[]>> = {
  reports: ["/reports/:id"],
  chat: ["/chat/:threadId"],
  groups: ["/groups/:id"],
  agents: ["/agents/new", "/agents/:id/:tab"],
  admin: ["/admin/trace/:agentId", "/admin/threads/:threadId"],
};
export function validateRegistrations(entries: readonly FeatureRegistration[]) {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (
      seen.has(entry.path) ||
      routes[entry.id] !== entry.path ||
      entry.role !== (adminFeatures.includes(entry.id) ? "ADMIN" : "USER") ||
      entry.layout !== (entry.role === "ADMIN" ? "admin" : "user") ||
      entry.detailPaths?.some((p) => !detailPaths[entry.id]?.includes(p))
    )
      throw new Error(`Invalid registration: ${entry.id}`);
    seen.add(entry.path);
  }
  return entries;
}

import type { Role } from "../../shared/contracts/auth";
import { features } from "../feature-registry";
export function requiredRole(path: string): Role | null {
  // "/admin" and "/admin/users" are separate features; match exact paths first
  return (
    features.find((f) => f.path === path)?.role ??
    features.find(
      (f) =>
        f.path === path ||
        f.detailPaths?.some((p) =>
          new RegExp(`^${p.replace(/:[a-zA-Z]+/g, "[^/]+")}$`).test(path),
        ),
    )?.role ?? null
  );
}

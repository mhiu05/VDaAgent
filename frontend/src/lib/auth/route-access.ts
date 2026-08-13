import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";

export const routeAccess: Array<{ prefix: string; permission: Permission }> = [
  { prefix: "/admin", permission: PERMISSIONS.workspaceActivityRead },
  { prefix: "/settings", permission: PERMISSIONS.workspaceSettingsManage },
  { prefix: "/chat", permission: PERMISSIONS.qaProfileAsk },
  { prefix: "/datasets", permission: PERMISSIONS.datasetRead },
  { prefix: "/profiles", permission: PERMISSIONS.profileRead },
  { prefix: "/analyses", permission: PERMISSIONS.analysisRun },
  { prefix: "/compare", permission: PERMISSIONS.driftRun },
];

export function requiredPermissionForPath(pathname: string): Permission | undefined {
  return routeAccess.find((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`))?.permission;
}

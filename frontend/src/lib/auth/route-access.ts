import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";

export const routeAccess: Array<{ prefix: string; permission: Permission }> = [
  { prefix: "/admin", permission: PERMISSIONS.userAccountsRead },
  { prefix: "/workspaces/manage", permission: PERMISSIONS.workspaceMembersManage },
  { prefix: "/workspaces", permission: PERMISSIONS.reportPublishedRead },
  { prefix: "/activity", permission: PERMISSIONS.workspaceAuditRead },
  { prefix: "/settings", permission: PERMISSIONS.workspaceSettingsManage },
  { prefix: "/chat", permission: PERMISSIONS.qaProfileAsk },
  { prefix: "/datasets", permission: PERMISSIONS.datasetRead },
  { prefix: "/profiles", permission: PERMISSIONS.profileRead },
  { prefix: "/charts", permission: PERMISSIONS.profileRead },
  { prefix: "/compare", permission: PERMISSIONS.driftRun },
  { prefix: '/calendar', permission: PERMISSIONS.calendarRead },
];

export function requiredPermissionForPath(pathname: string): Permission | undefined {
  return routeAccess.find((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`))?.permission;
}

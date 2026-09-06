"use client";

import { useAuth } from "@/components/auth-provider";
import { can, type Permission } from "@/lib/auth/permissions";

export function useCan(permission: Permission): boolean {
  return can(useAuth().me?.effective_permissions, permission);
}

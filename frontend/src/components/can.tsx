"use client";

import type { ReactNode } from "react";
import { useCan } from "@/lib/auth/use-can";
import type { Permission } from "@/lib/auth/permissions";

export function Can({ permission, children, fallback = null }: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  return useCan(permission) ? <>{children}</> : <>{fallback}</>;
}

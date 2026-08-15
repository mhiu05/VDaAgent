import type { SelfSignupRole } from "@/lib/api";

const SELF_SIGNUP_ROLES: SelfSignupRole[] = ["analyst"];

/** Resolve the role stored by the signup flow, with a safe recovery default. */
export function requestedSignupRole(metadataRole: unknown): SelfSignupRole {
  return SELF_SIGNUP_ROLES.includes(metadataRole as SelfSignupRole)
    ? metadataRole as SelfSignupRole
    : "analyst";
}

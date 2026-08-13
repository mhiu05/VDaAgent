import { describe, expect, it } from "vitest";
import { requestedSignupRole } from "@/lib/auth/onboarding";

describe("requestedSignupRole", () => {
  it.each(["viewer", "analyst", "admin"])("keeps valid role %s", (role) => {
    expect(requestedSignupRole(role)).toBe(role);
  });

  it.each([undefined, null, "owner", 42])("falls back to analyst for invalid metadata %s", (role) => {
    expect(requestedSignupRole(role)).toBe("analyst");
  });
});

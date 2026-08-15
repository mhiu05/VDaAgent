import { describe, expect, it } from "vitest";
import { requestedSignupRole } from "@/lib/auth/onboarding";

describe("requestedSignupRole", () => {
  it("keeps Analyst as the only valid role", () => {
    expect(requestedSignupRole("analyst")).toBe("analyst");
  });

  it.each([undefined, null, "owner", 42])("falls back to analyst for invalid metadata %s", (role) => {
    expect(requestedSignupRole(role)).toBe("analyst");
  });
});

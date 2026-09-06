import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PublicNavbar } from "./public-navbar";

const authState = {
  authenticated: true,
  isGuest: false,
  guestRole: null,
  me: null,
  loading: true,
  enterGuestRole: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ prefetch: vi.fn() }),
}));
vi.mock("next/image", () => ({ default: () => <span aria-hidden="true" /> }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => authState }));

describe("PublicNavbar", () => {
  beforeEach(() => {
    authState.authenticated = true;
    authState.isGuest = false;
    authState.loading = true;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  it("keeps authenticated actions visible while workspace bootstrap is loading", () => {
    render(<PublicNavbar />);

    expect(screen.getByRole("link", { name: "Workspace" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mở menu tài khoản" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Đăng nhập" })).toBeNull();
  });
});

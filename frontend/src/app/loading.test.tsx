import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Loading from "./loading";

const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: usePathnameMock }));

describe("app loading boundary", () => {
  beforeEach(() => {
    usePathnameMock.mockReset();
  });

  it("does not show workspace loading for public navigation", () => {
    usePathnameMock.mockReturnValue("/about");

    render(<Loading />);

    expect(screen.queryByText("Đang mở không gian làm việc...")).toBeNull();
  });

  it("keeps workspace loading for protected routes", () => {
    usePathnameMock.mockReturnValue("/datasets");

    render(<Loading />);

    expect(screen.getByText("Đang mở không gian làm việc...")).toBeTruthy();
  });
});

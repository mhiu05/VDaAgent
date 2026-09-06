import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatProgress } from "./chat-progress";

describe("ChatProgress", () => {
  afterEach(() => vi.useRealTimers());

  it("shows elapsed time without manufacturing progress stages", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:00Z"));
    render(<ChatProgress message={{ id: "agent", role: "agent", text: "", status: "streaming", startedAt: Date.now() - 3_000, statusDetail: "Validating evidence" }} fallback="Preparing request" />);

    expect(screen.getByText("Validating evidence · 3s")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText("Validating evidence · 5s")).toBeTruthy();
  });
});

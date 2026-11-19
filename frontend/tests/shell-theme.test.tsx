import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/app/App";
import { createMockServices } from "../src/app/services/create-mock-services";

describe("shell theme toggle", () => {
  it("does not render a quick theme toggle", async () => {
    const services = createMockServices();
    await services.auth.login("user@vdaagent.test", "DemoUser!2026");
    history.replaceState({}, "", "/");
    render(<App services={services} />);
    await screen.findByRole("main");
    expect(screen.queryByRole("button", { name: "Đổi giao diện" })).toBeNull();
  });
});

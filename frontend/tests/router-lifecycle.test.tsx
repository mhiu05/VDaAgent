import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/app/App";
import { createMockServices } from "../src/app/services/create-mock-services";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState({}, "", "/");
});

it("initializes each mounted App from its current URL instead of retaining an old router", async () => {
  const services = createMockServices();
  vi.spyOn(services.context.clock, "sleep").mockResolvedValue(undefined);
  const account = services.auth.demoAccounts.find(
    (account) => account.role === "USER",
  )!;
  expect(
    (await services.auth.login(account.email, account.password)).error,
  ).toBeUndefined();

  history.replaceState({}, "", "/setting");
  const first = render(<App services={services} />);
  await screen.findByRole("heading", { level: 1, name: "Cài đặt không gian" });
  first.unmount();

  history.replaceState({}, "", "/notifications");
  render(<App services={services} />);
  await screen.findByRole("heading", { level: 1, name: "Hộp thư nghiên cứu" });
  expect(
    screen.queryByRole("heading", { name: "Cài đặt không gian" }),
  ).toBeNull();
});

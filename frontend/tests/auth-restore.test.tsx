import { StrictMode } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import { expect, it } from "vitest";
import { createMockServices } from "../src/app/services/create-mock-services";
import { ServicesProvider } from "../src/app/providers/ServicesProvider";
import { AuthProvider, useAuth } from "../src/features/auth/providers/AuthProvider";
import type { Session } from "../src/shared/contracts/auth";
import type { ServiceResult } from "../src/shared/contracts/service-result";

it("ignores an older restore finishing after the current session", async () => {
  const services = createMockServices();
  const pending: ((value: ServiceResult<Session | null>) => void)[] = [];
  services.auth.restore = () => new Promise((resolve) => pending.push(resolve));
  function Probe() { return <p>{useAuth().snapshot.status}</p>; }
  render(<StrictMode><ServicesProvider services={services}>
    <AuthProvider><Probe /></AuthProvider>
  </ServicesProvider></StrictMode>);
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[1]({ data: {
    principal: { id: "current", email: "current", displayName: "Current", role: "USER" },
    domain: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  } }));
  expect(screen.getByText("authenticated")).toBeInTheDocument();
  await act(async () => pending[0]({ data: null }));
  expect(screen.getByText("authenticated")).toBeInTheDocument();
});

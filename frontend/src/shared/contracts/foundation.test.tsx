import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workspace } from "../../app/integrations/workspace";
import { validateRegistrations } from "./feature-registration";
import { requiredRole } from "../../app/routing/access";
import { homeFor } from "./auth";
import { targetPath } from "./notification-target";
import { defaultPreferences, isPreferences } from "./preferences";
import { Button } from "../ui/button";
import { Dialog } from "../ui/overlay";
import { TableSurface, ChartFrame } from "../ui/data";
import { PageFrame } from "../ui/page";
import { createStorage } from "../../mocks/core/storage";
import { createAuthMockService } from "../../mocks/auth/entry";
import { createReportsMockService } from "../../mocks/reports/entry";
import { createDashboardMockService } from "../../mocks/dashboard/entry";
import { fixtureEpoch } from "../../mocks/core/clock";
import { seededId, type MockContext } from "../../mocks/core/scenarios";
import { safeUrl } from "../lib/url-policy";
import { formatDate, dayKey } from "../lib/format";
import { createMockServices } from "../../app/services/create-mock-services";
import {
  ServicesProvider,
  useServices,
  useWorkspaceService,
} from "../../app/providers/ServicesProvider";
const ctx = (): MockContext => ({
  clock: { now: () => new Date(fixtureEpoch), sleep: async () => {} },
  seed: 42,
  scenario: "success",
  storage: createStorage("sessionStorage"),
});
describe("frozen integration contract", () => {
  it("registers only valid typed workspace routes and rejects duplicate or wrong role", () => {
    expect(validateRegistrations(workspace.registrations)).toHaveLength(3);
    expect(() =>
      validateRegistrations([
        ...workspace.registrations,
        workspace.registrations[0],
      ]),
    ).toThrow();
    expect(() =>
      validateRegistrations([{ ...workspace.registrations[0], role: "ADMIN" }]),
    ).toThrow();
    expect(workspace.hasReport("missing")).toBe(false);
  });
  it("creates usable Core services and injects the bridge factory result unchanged", async () => {
    const actualFactory = workspace.createServices;
    const factory = vi
      .spyOn(workspace, "createServices")
      .mockImplementation((context) => ({
        ...actualFactory(context),
        "foundation-probe": { now: () => context.clock.now().toISOString() },
      }));
    const services = createMockServices();
    expect(factory).toHaveBeenCalledExactlyOnceWith(services.context);
    expect(services.workspace).toBe(factory.mock.results[0].value);
    vi.spyOn(services.context.clock, "now").mockReturnValue(
      new Date(fixtureEpoch),
    );
    function Consumer() {
      const injected = useServices();
      const probe = useWorkspaceService<{ now(): string }>("foundation-probe");
      expect(injected).toBe(services);
      expect(probe).toBe(services.workspace["foundation-probe"]);
      return <p>{probe.now()}</p>;
    }
    render(
      <ServicesProvider services={services}>
        <Consumer />
      </ServicesProvider>,
    );
    expect(screen.getByText(fixtureEpoch)).toBeInTheDocument();
    const account = services.auth.demoAccounts.find(
      (account) => account.role === "USER",
    )!;
    const login = await services.auth.login(account.email, account.password);
    expect(login.error).toBeUndefined();
    expect(login.data?.principal.role).toBe("USER");
    expect((await services.auth.restore()).data).toEqual(login.data);
    const principal = login.data!.principal;
    const [chat, notifications] = await Promise.all([
      services.chat.load(principal.id),
      services.notifications.list(principal.id),
    ]);
    expect(chat.error).toBeUndefined();
    expect(chat.data?.conversations.length).toBeGreaterThan(0);
    expect(services.chat.catalog()).toHaveLength(6);
    expect(notifications.error).toBeUndefined();
    expect(notifications.data).toEqual(
      services.notifications.snapshot(principal.id),
    );
    expect(
      isPreferences(
        services.preferences.load(principal.id, principal.displayName),
      ),
    ).toBe(true);
    services.auth.logout();
    expect((await services.auth.restore()).data).toBeNull();
  });
  it("keeps roles independent and routes exact", () => {
    expect(homeFor("ADMIN", true)).toBe("/admin");
    expect(homeFor("USER", true)).toBe("/chat");
    expect(homeFor("ADMIN", false)).toBe("/admin/users");
    expect(homeFor("USER", false)).toBe("/");
    expect(requiredRole("/chat")).toBe("USER");
    expect(requiredRole("/reports/a")).toBe("USER");
    expect(requiredRole("/admin/users")).toBe("ADMIN");
    expect(requiredRole("/admin/other")).toBeNull();
  });
  it("encodes targets and version without adding backend endpoints", () => {
    expect(
      targetPath({ kind: "report", reportId: "a b", versionId: "v2" }),
    ).toBe("/reports?report=a+b&version=v2");
    expect(targetPath({ kind: "chat", conversationId: "x&y" })).toBe(
      "/chat?conversation=x%26y",
    );
    expect(targetPath({ kind: "account" })).toBe("/setting");
    expect(
      targetPath({ kind: "system-detail", notificationId: "n" }),
    ).toBeNull();
  });
  it("composes frame, table and chart semantics without a second main", () => {
    const { container } = render(
      <PageFrame title="Study">
        <ChartFrame
          title="Price"
          unit="VND"
          scope="Demo"
          summary="Illustrative"
        >
          <TableSurface
            caption="Values"
            header={
              <tr>
                <th>City</th>
              </tr>
            }
          >
            <tr>
              <td>Hà Nội</td>
            </tr>
          </TableSurface>
        </ChartFrame>
      </PageFrame>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Study",
    );
    expect(container.querySelectorAll("main")).toHaveLength(0);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
describe("storage, auth and formatting boundaries", () => {
  it.each(["alice", "vre-demo"] as const)("opens the fixture dashboard and reports after %s demo login", async (profile) => {
    const context = ctx();
    const auth = createAuthMockService(context);
    const session = (await auth.loginDemo(profile)).data!;
    const reports = createReportsMockService(context);
    const catalog = await reports.catalog(session.principal);
    expect(catalog.error).toBeUndefined();
    const dashboard = createDashboardMockService(context, reports);
    const overview = await dashboard.overview(session.principal, catalog.data!.defaultScope);
    expect(overview.error).toBeUndefined();
    expect(overview.data?.inventory.state).toBe("ready");
    expect(overview.data?.reports.state).toBe("ready");
  });
  it("validates preferences and scoped keys; corrupt/blocked storage falls back", () => {
    const s = createStorage("localStorage");
    const p = defaultPreferences("Demo");
    s.set("a", "preferences", p);
    expect(s.get("b", "preferences", isPreferences)).toBeNull();
    expect(s.get("a", "preferences", isPreferences)).toEqual(p);
    expect(isPreferences({ ...p, timezone: "bad/time" })).toBe(false);
    localStorage.setItem("vdaagent:v1:a:preferences", "{");
    expect(s.get("a", "preferences", isPreferences)).toBeNull();
    expect(s.degraded).toBe(true);
    const fallback = createStorage("localStorage", true);
    expect(fallback.set("x", "preferences", p)).toBe(false);
    expect(fallback.get("x", "preferences", isPreferences)).toEqual(p);
  });
  it("auth stores no password and restores expiry using an injected clock", async () => {
    sessionStorage.clear();
    const context = ctx();
    const auth = createAuthMockService(context);
    expect((await auth.login("bad", "bad")).error?.code).toBe("credentials");
    const r = await auth.login("user@vdaagent.test", "DemoUser!2026");
    expect(r.data?.principal.role).toBe("USER");
    expect(JSON.stringify(sessionStorage)).not.toContain("DemoUser!");
    expect((await auth.restore()).data?.principal.id).toBe(
      r.data?.principal.id,
    );
    context.clock.now = () => new Date("2026-10-17T08:00:00Z");
    expect((await auth.restore()).error?.code).toBe("expired");
    auth.logout();
  });
  it("has deterministic IDs, safe links and timezone day keys", () => {
    expect(seededId(42, "m", 1)).toBe("m-42-1");
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("//evil.test")).toBeUndefined();
    expect(safeUrl("https://example.com")).toBe("https://example.com/");
    expect(dayKey("2026-10-16T23:30:00Z", "Asia/Bangkok")).not.toBe(
      dayKey("2026-10-16T23:30:00Z", "UTC"),
    );
    expect(formatDate(fixtureEpoch, "vi", "UTC")).toContain("2026");
  });
});
describe("shared control behavior", () => {
  it("supports keyboard, focus, disabled and long labels", async () => {
    const click = vi.fn();
    render(
      <>
        <Button onClick={click}>
          A long Vietnamese label — Dữ liệu nghiên cứu
        </Button>
        <Button disabled onClick={click}>
          Disabled
        </Button>
      </>,
    );
    await userEvent.tab();
    expect(screen.getByRole("button", { name: /long/ })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(click).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByText("Disabled"));
    expect(click).toHaveBeenCalledTimes(1);
  });
  it("traps dialog focus and closes with Escape", async () => {
    const close = vi.fn();
    render(
      <Dialog open onOpenChange={close} title="Evidence" closeLabel="Close">
        <Button>Source</Button>
      </Dialog>,
    );
    expect(
      screen.getByRole("dialog", { name: "Evidence" }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(close).toHaveBeenCalledWith(false);
  });
});

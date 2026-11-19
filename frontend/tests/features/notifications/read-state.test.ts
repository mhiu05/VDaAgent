import { describe, it, expect } from "vitest";
import { createNotificationsMockService } from "../../../src/mocks/notifications/entry";
import { createStorage } from "../../../src/mocks/core/storage";
import { fixtureEpoch } from "../../../src/mocks/core/clock";
import { resolveTarget } from "../../../src/app/routing/targets";
import type { MockContext } from "../../../src/mocks/core/scenarios";
const context: MockContext = {
  clock: { now: () => new Date(fixtureEpoch), sleep: async () => {} },
  seed: 42,
  storage: createStorage("localStorage"),
  scenario: "success",
};
describe("notification state and target contract", () => {
  it("rolls back optimistic read state on failure", async () => {
    const s = createNotificationsMockService({ ...context, scenario: "error" });
    const before = s.snapshot("rollback").filter((n) => !n.readAt).length;
    const events: number[] = [];
    s.subscribe(() =>
      events.push(s.snapshot("rollback").filter((n) => !n.readAt).length),
    );
    expect((await s.markRead("rollback")).error).toBeDefined();
    expect(events).toEqual([0, before]);
  });
  it("persists reads per principal and resets one scope", async () => {
    const s = createNotificationsMockService(context);
    const id = s.snapshot("read-a")[0].id;
    await s.markRead("read-a", id);
    expect(s.snapshot("read-a")[0].readAt).toBeTruthy();
    expect(s.snapshot("read-b")[0].readAt).toBeNull();
    s.reset("read-a");
    expect(s.snapshot("read-a")[0].readAt).toBeNull();
  });
  it("keeps missing, restricted roles, and pending reports from blind navigation", () => {
    expect(
      resolveTarget(
        { kind: "chat", conversationId: "a" },
        "USER",
        ["a"],
        () => false,
      ),
    ).toBe("/chat?conversation=a");
    expect(
      resolveTarget(
        { kind: "chat", conversationId: "missing" },
        "USER",
        ["a"],
        () => false,
      ),
    ).toBeNull();
    expect(
      resolveTarget({ kind: "report", reportId: "r" }, "USER", [], () => false),
    ).toBeNull();
    expect(
      resolveTarget({ kind: "account" }, "ADMIN", [], () => true),
    ).toBeNull();
  });
});

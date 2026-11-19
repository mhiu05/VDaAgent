import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMockServices } from "../src/app/services/create-mock-services";
import {
  ServicesProvider,
  useWorkspaceService,
} from "../src/app/providers/ServicesProvider";
import { messages as auth } from "../src/features/auth/entry";
import { messages as chat } from "../src/features/chat/entry";
import { messages as notifications } from "../src/features/notifications/entry";
import { messages as settings } from "../src/features/settings/entry";
import { coreMessages } from "../src/app/i18n/messages";
import { createPreferencesMockService } from "../src/mocks/settings/entry";
import { createStorage } from "../src/mocks/core/storage";
import { defaultPreferences } from "../src/shared/contracts/preferences";
import css from "../src/shared/styles/tokens.css?raw";
function luminance(hex: string) {
  const values = hex
    .replace("#", "")
    .match(/../g)!
    .map((h) => parseInt(h, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
describe("Machine 2 producer/consumer boundaries", () => {
  it("injects a typed feature service through the existing root", () => {
    const services = {
      ...createMockServices(),
      workspace: { reports: { caption: "Injected by bridge" } },
    };
    function Consumer() {
      const service = useWorkspaceService<{ caption: string }>("reports");
      return <p>{service.caption}</p>;
    }
    render(
      <ServicesProvider services={services}>
        <Consumer />
      </ServicesProvider>,
    );
    expect(screen.getByText("Injected by bridge")).toBeInTheDocument();
  });
  it("exports complete equivalent vi/en namespaces", () => {
    for (const messages of [
      auth,
      chat,
      notifications,
      settings,
      coreMessages,
    ]) {
      expect(Object.keys(messages.vi).sort()).toEqual(
        Object.keys(messages.en).sort(),
      );
      for (const locale of ["vi", "en"] as const)
        expect(
          Object.values(messages[locale]).every(
            (v) => typeof v === "string" && v.length > 0,
          ),
        ).toBe(true);
    }
  });
  it("preserves principal-scoped saved preferences and memory-only fallback", async () => {
    const storage = createStorage("localStorage", true);
    const service = createPreferencesMockService({
      clock: {
        now: () => new Date("2026-10-16T08:00:00Z"),
        sleep: async () => {},
      },
      seed: 42,
      storage,
      scenario: "success",
    });
    const prefs = {
      ...defaultPreferences("A"),
      locale: "en" as const,
      theme: "dark" as const,
    };
    expect((await service.save("a", prefs)).data).toEqual(prefs);
    expect(service.load("a", "A")).toEqual(prefs);
    expect(service.load("b", "B").displayName).toBe("B");
    expect(service.degraded).toBe(true);
  });
  it("measures normal-text and control contrast on the actual theme tokens", () => {
    for (const block of css.matchAll(/:root[^{}]*\{([^}]+)\}/g)) {
      const tokens = Object.fromEntries(
        [...block[1].matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [
          m[1],
          m[2],
        ]),
      );
      for (const surface of [
        "--canvas",
        "--surface",
        "--surface-subtle",
        "--selected",
      ]) {
        for (const text of ["--text", "--text-muted"])
          expect(
            contrast(tokens[text], tokens[surface]),
            `${text}/${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        contrast(tokens["--on-primary"], tokens["--primary"]),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(tokens["--on-danger"], tokens["--danger"]),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(tokens["--control-border"], tokens["--surface"]),
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(tokens["--focus"], tokens["--surface"]),
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

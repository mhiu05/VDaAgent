import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../app/i18n/messages";
import { defaultPreferences } from "../../../shared/contracts/preferences";
import { gsap } from "../../../shared/motion/useAnalyticalMotion";
import {
  createReportFixtures,
  demoClock,
  demoUser,
} from "../../../mocks/reports/fixtures";
import { createReportsRepository } from "../../../mocks/reports/repository";
import { ReportDashboard } from "../components/ReportDashboard";
import { ReportDocument } from "../components/ReportDocument";

vi.mock("../../../app/providers/PreferencesProvider", () => ({
  usePreferences: () => ({
    preferences: defaultPreferences(),
    reducedMotion: false,
  }),
}));
afterEach(() => vi.unstubAllGlobals());

describe("saved chart motion identity", () => {
  it.each(["overview", "reader"] as const)(
    "does not restart legacy chart motion after an ordinary %s rerender",
    async (mode) => {
      vi.stubGlobal("matchMedia", () => ({ matches: false }));
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 640,
        bottom: 300,
        width: 640,
        height: 300,
        toJSON() {},
      });
      const detail = await createReportsRepository(createReportFixtures(), {
        principal: demoUser,
        clock: demoClock,
      }).readDetail("R001", "R001-v2");
      const View = mode === "overview" ? ReportDashboard : ReportDocument;
      const surface = () => (
        <I18nextProvider i18n={i18n}>
          <View detail={detail} />
        </I18nextProvider>
      );
      const view = render(surface());
      const clip = view.container.querySelector("[data-chart-clip]")!;
      const tween = gsap.getTweensOf(clip)[0];
      expect(tween).toBeDefined();
      view.rerender(surface());
      expect(gsap.getTweensOf(clip)).toEqual([tween]);
      view.unmount();
      expect(gsap.getTweensOf(clip)).toEqual([]);
    },
  );
});

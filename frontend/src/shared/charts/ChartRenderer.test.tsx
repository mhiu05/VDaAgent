import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { i18n } from "../../app/i18n/messages";
import { ChartRenderer } from "./ChartRenderer";
import { chartFixture } from "./chart-test-fixtures";
import { chartRegistry } from "./chart-registry";
import { gsap } from "../motion/useAnalyticalMotion";
import type { ChartType } from "./chart-contract";
import { defaultPreferences } from "../contracts/preferences";

vi.mock("../../app/providers/PreferencesProvider", () => ({
  usePreferences: () => ({
    preferences: { ...defaultPreferences(), locale: "en" },
  }),
}));
function mount(type: ChartType) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ChartRenderer spec={chartFixture(type)} scope="2026-10-15" />
    </I18nextProvider>,
  );
}
describe("accessible chart presentation", () => {
  it("labels small horizontal bars with exact values and retains readable category labels", () => {
    const spec = chartFixture("bar");
    spec.labels = ["90–179 ngày", "180–359 ngày", "Chưa rõ tuổi"];
    spec.series = [
      { id: "count", label: "Count", unit: "units", values: [24, null, 0] },
    ];
    const view = render(
      <I18nextProvider i18n={i18n}>
        <ChartRenderer spec={spec} scope="cutoff" />
      </I18nextProvider>,
    );
    expect(
      [...view.container.querySelectorAll("[data-chart-value]")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["24", "0"]);
    expect(view.container.querySelector("svg")).toHaveTextContent(
      "180–359 ngày",
    );
    expect(view.container.querySelector("svg")).toHaveTextContent(
      "Chưa rõ tuổi",
    );
  });
  it.each(["compact", "reading", "expanded"] as const)(
    "keeps signed, missing and zero table values in %s presentation",
    async (presentation) => {
      const spec = chartFixture("column");
      spec.series[0].values = [-2.25, null, 0];
      const before = JSON.stringify(spec);
      const view = render(
        <I18nextProvider i18n={i18n}>
          <ChartRenderer
            spec={spec}
            scope="selected cutoff"
            presentation={presentation}
          />
        </I18nextProvider>,
      );
      await userEvent.click(
        screen.getByText(/Equivalent data table|Bảng dữ liệu tương đương/),
      );
      const table = screen.getByRole("table");
      expect(table).toHaveTextContent("-2.25");
      expect(table).toHaveTextContent("—");
      expect(within(table).getAllByRole("row")[3]).toHaveTextContent("0");
      expect(JSON.stringify(spec)).toBe(before);
      expect(view.container.querySelectorAll(".schema-chart")).toHaveLength(1);
    },
  );
  it("uses a single wrapper tween for a dense scatter and releases it on unmount", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("no-preference"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 640,
      bottom: 300,
      width: 640,
      height: 300,
      toJSON() {
        return {};
      },
    });
    const spec = chartFixture("scatter");
    spec.labels = Array.from({ length: 1500 }, (_, i) => i);
    spec.series[0].values = spec.labels.map((_, i) => i % 20);
    const before = JSON.stringify(spec);
    const view = render(
      <I18nextProvider i18n={i18n}>
        <ChartRenderer spec={spec} scope="selected cutoff" />
      </I18nextProvider>,
    );
    const marks = [...view.container.querySelectorAll("[data-chart-mark]")];
    const wrapper = view.container.querySelector(".schema-chart-scroll")!;
    expect(marks).toHaveLength(1500);
    expect(gsap.getTweensOf(marks)).toHaveLength(0);
    expect(gsap.getTweensOf(wrapper)).toHaveLength(1);
    expect(JSON.stringify(spec)).toBe(before);
    view.unmount();
    expect(gsap.getTweensOf(wrapper)).toHaveLength(0);
    vi.unstubAllGlobals();
  });
  it.each(Object.keys(chartRegistry) as ChartType[])(
    "renders %s geometry, legend, units and table",
    async (type) => {
      const { container } = mount(type);
      expect(screen.getByRole("img")).toHaveAccessibleName();
      expect(
        container.querySelectorAll(
          "svg rect, svg circle, svg path, svg polyline",
        ).length,
      ).toBeGreaterThan(0);
      expect(container.querySelector("svg title")?.textContent).toContain(
        "items",
      );
      if (type === "heatmap") {
        expect(container.querySelectorAll(".chart-legend li")).toHaveLength(1);
        expect(container.querySelector(".chart-legend")).toHaveTextContent(
          "1 – 4 items",
        );
      }
      await userEvent.click(
        screen.getByText(/Equivalent data table|Bảng dữ liệu tương đương/),
      );
      const table = screen.getByRole("table");
      expect(within(table).getAllByRole("row")).toHaveLength(4);
      expect(table).toHaveTextContent("items");
    },
  );
  it("switches only compatible presentations without changing saved values", async () => {
    const spec = chartFixture("line");
    const before = JSON.stringify(spec);
    render(
      <I18nextProvider i18n={i18n}>
        <ChartRenderer spec={spec} scope="cutoff" />
      </I18nextProvider>,
    );
    const select = screen.getByRole("combobox");
    expect(within(select).getAllByRole("option")).toHaveLength(4);
    await userEvent.selectOptions(select, "area");
    expect(select).toHaveValue("area");
    expect(JSON.stringify(spec)).toBe(before);
  });
  it("breaks line and area paths at null observations", () => {
    const spec = chartFixture("line");
    spec.series[0].values = [4, null, 2];
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <ChartRenderer spec={spec} scope="cutoff" />
      </I18nextProvider>,
    );
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });
  it("shows original data immediately for unknown and incompatible charts", () => {
    const spec = { ...chartFixture("pie"), type: "future" };
    render(
      <I18nextProvider i18n={i18n}>
        <ChartRenderer spec={spec} scope="cutoff" />
      </I18nextProvider>,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("First (items)");
    expect(screen.getByRole("status")).toBeVisible();
  });
  it("keeps zero on signed bar axes and formats tooltip numbers with units", () => {
    const spec = chartFixture("column");
    spec.series[0].values = [-2, 0, 3.25];
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <ChartRenderer spec={spec} scope="cutoff" />
      </I18nextProvider>,
    );
    expect(container.querySelector(".chart-zero")).not.toBeNull();
    const tips = [...container.querySelectorAll("svg title")].map(
      (e) => e.textContent,
    );
    expect(tips).toContain("C · First: 3.25 items");
  });
});

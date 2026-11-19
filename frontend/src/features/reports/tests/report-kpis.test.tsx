import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "../../../app/i18n/messages";
import { defaultPreferences } from "../../../shared/contracts/preferences";
import { ReportKpis } from "../components/ReportKpis";

vi.mock("../../../app/providers/PreferencesProvider", () => ({
  usePreferences: () => ({
    preferences: { ...defaultPreferences(), locale: "en" },
  }),
}));
describe("saved KPI presentation", () => {
  it("shows exact signed, zero and missing quantities and keeps complete definitions accessible", async () => {
    const metrics = [
      {
        id: "null",
        label: "Unavailable income",
        value: null,
        unit: "VND",
        definition: "Income was not provided in this version.",
      },
      { id: "zero", label: "Observed zero", value: 0, unit: "units" },
      { id: "signed", label: "Signed quantity", value: -12.25, unit: "items" },
    ];
    const before = JSON.stringify(metrics);
    const view = render(
      <I18nextProvider i18n={i18n}>
        <ReportKpis metrics={metrics} />
      </I18nextProvider>,
    );
    expect(view.container.querySelectorAll("dd strong")[0]).toHaveTextContent(
      "—",
    );
    expect(view.container.querySelectorAll("dd strong")[1]).toHaveTextContent(
      "0",
    );
    expect(view.container.querySelectorAll("dd strong")[2]).toHaveTextContent(
      "-12.25",
    );
    await userEvent.click(view.container.querySelector("summary")!);
    expect(screen.getByText(metrics[0].definition!)).toBeVisible();
    expect(JSON.stringify(metrics)).toBe(before);
  });
});

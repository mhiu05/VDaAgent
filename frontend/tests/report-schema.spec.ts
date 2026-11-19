import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";

async function login(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript(
    (theme) =>
      localStorage.setItem(
        "vdaagent:v1:demo-user-01:preferences",
        JSON.stringify({
          displayName: "Demo",
          locale: "en",
          theme,
          timezone: "Asia/Bangkok",
          motion: "reduce",
          density: "comfortable",
          notifications: { reports: true, tasks: true, system: true },
          semanticExplanation: false,
        }),
      ),
    theme,
  );
  await page.goto("/login");
  await page.getByRole("button", { name: /USER .*@vdaagent.test/ }).click();
  await page
    .getByRole("button", { name: "Vào không gian làm việc", exact: true })
    .click();
  await expect(page).toHaveURL("/");
}
const target = (
  scenario = "report-showcase",
  id = "R019",
  sequence = 2,
  view = "dashboard",
) =>
  `/reports?scenario=${scenario}&report=${id}&version=${id}-v${sequence}&view=${view}`;
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (e) => messages.push(e.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test("a data-only custom type travels from catalog/card to versioned dashboard, document and download", async ({
  page,
}) => {
  await login(page);
  await page.goto(
    "/reports?scenario=report-showcase&type=customer-segmentation",
  );
  await expect(page.locator("#report-type")).toHaveValue(
    "customer-segmentation",
  );
  const card = page
    .locator(".report-card")
    .filter({ hasText: "VDA-DEMO-CUSTOM" });
  await expect(card).toContainText("Customer segmentation");
  await card.getByRole("link").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".report-dashboard")).toHaveAttribute(
    "data-version",
    "R019-v2",
  );
  await expect(dialog.locator(".report-kpis")).toContainText("72");
  await expect(dialog.locator(".schema-chart")).toHaveCount(7);
  await dialog.locator("#report-version").selectOption("R019-v1");
  await expect(dialog.locator(".report-dashboard")).toHaveAttribute(
    "data-version",
    "R019-v1",
  );
  await expect(dialog.locator(".report-kpis")).toContainText("60");
  await dialog
    .getByRole("button", { name: "Read full report", exact: true })
    .click();
  await expect(dialog.locator(".report-reader")).toHaveAttribute(
    "data-version",
    "R019-v1",
  );
  await expect(dialog.locator(".report-document")).toContainText(
    "Nguồn phân khúc mô phỏng v1",
  );
  await dialog
    .getByRole("navigation", { name: "Contents", exact: true })
    .getByRole("link", { name: "Bằng chứng bản lưu" })
    .click();
  await expect(dialog.locator(".report-schema-evidence")).toBeFocused();
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download HTML", exact: true }).click();
  const download = await downloadEvent;
  const content = await fs.readFile((await download.path())!, "utf8");
  expect(content).toContain("R019-v1");
  expect(content).toContain("60");
  expect(content).not.toContain("R019-v2");
  await page.reload();
  await expect(page.locator(".report-reader")).toHaveAttribute(
    "data-version",
    "R019-v1",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#report-type")).toHaveValue(
    "customer-segmentation",
  );
});

for (const theme of ["light", "dark"] as const)
  for (const width of [1440, 1366, 768, 390, 320]) {
    test(`custom charts and document reflow at ${width}px ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page, theme);
      await page.goto(target());
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator(".schema-chart")).toHaveCount(7);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      await dialog.screenshot({
        path: info.outputPath(`custom-dashboard-${width}-${theme}.png`),
      });
      await dialog
        .locator(".report-schema-chart")
        .first()
        .scrollIntoViewIfNeeded();
      expect(
        await dialog
          .locator(".schema-chart-radial")
          .first()
          .evaluate(
            (svg) =>
              svg.getBoundingClientRect().width <=
              svg.parentElement!.clientWidth + 1,
          ),
      ).toBe(true);
      await dialog.screenshot({
        path: info.outputPath(`custom-charts-${width}-${theme}.png`),
      });
      const results = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .analyze();
      expect(results.violations).toEqual([]);
      const switcher = dialog.getByRole("combobox", {
        name: "Chart presentation: Cơ cấu phân khúc",
        exact: true,
      });
      await switcher.selectOption("pie");
      await expect(switcher).toHaveValue("pie");
      await dialog
        .getByRole("button", { name: "Read full report", exact: true })
        .click();
      await expect(dialog.locator(".report-document")).toContainText(
        "Phương pháp và giới hạn",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await dialog.screenshot({
        path: info.outputPath(`custom-document-${width}-${theme}.png`),
      });
      const documentAudit = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .analyze();
      expect(documentAudit.violations).toEqual([]);
    });
  }

test("inventory, sales and benchmarking use the same schema renderer and retain their original evidence", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.goto("/reports?scenario=report-showcase");
  await expect(page.locator(".report-card")).toHaveCount(19);
  await page.screenshot({
    path: info.outputPath("report-library.png"),
    fullPage: true,
  });
  for (const [id, sequence, label] of [
    ["R001", 2, "inventory"],
    ["R004", 1, "sales"],
    ["R007", 1, "benchmark"],
  ] as const) {
    await page.goto(target("report-showcase", id, sequence));
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".report-dashboard")).toHaveAttribute(
      "data-version",
      `${id}-v${sequence}`,
    );
    await expect(dialog.locator(".schema-chart").first()).toBeVisible();
    await dialog.screenshot({
      path: info.outputPath(`${label}-dashboard.png`),
    });
    await dialog
      .getByRole("button", { name: "Read full report", exact: true })
      .click();
    await expect(dialog.locator(".report-reader")).toHaveAttribute(
      "data-version",
      `${id}-v${sequence}`,
    );
    await expect(dialog.locator(".report-document")).toContainText(
      "Nguồn demo",
    );
    await dialog.screenshot({ path: info.outputPath(`${label}-document.png`) });
  }
});

for (const scenario of [
  "report-unknown-chart",
  "report-invalid-chart",
  "report-unknown-schema",
  "report-unknown-type",
  "report-empty-schema",
] as const) {
  test(`${scenario} preserves the viewer with a meaningful fallback`, async ({
    page,
  }, info) => {
    await login(page);
    await page.goto(target(scenario));
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#report-version")).toHaveValue("R019-v2");
    if (
      scenario === "report-unknown-chart" ||
      scenario === "report-invalid-chart"
    ) {
      await expect(dialog.getByRole("table")).toBeVisible();
      await expect(dialog.getByRole("status")).toContainText(
        "incompatible or unsupported",
      );
      await expect(dialog.locator(".schema-chart")).toHaveCount(0);
    } else if (scenario === "report-unknown-schema")
      await expect(dialog).toContainText("schema version is unsupported");
    else if (scenario === "report-empty-schema")
      await expect(dialog).toContainText("no summary metrics or charts");
    else await expect(dialog.locator(".report-kpis")).toContainText("72");
    await dialog.screenshot({ path: info.outputPath(`${scenario}.png`) });
  });
}

test("large schema tables page through original values with a bounded row count", async ({
  page,
}) => {
  await login(page);
  await page.goto(target("report-large-table"));
  const table = page.getByRole("dialog").getByRole("table");
  await expect(table.locator("tbody tr")).toHaveCount(25);
  await expect(table).toContainText("Mẫu 25");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(table).toContainText("Mẫu 26");
  await expect(table).toContainText("Mẫu 50");
  await expect(table.locator("tbody tr")).toHaveCount(25);
  // Every original row remains reachable in compact mode; reader pages stay at 100.
  for (let pageNumber = 3; pageNumber <= 48; pageNumber++) {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Next", exact: true })
      .click();
    await expect(table).toContainText(`Mẫu ${pageNumber * 25}`);
    await expect(table.locator("tbody tr")).toHaveCount(25);
  }
  await page
    .getByRole("button", { name: "Read full report", exact: true })
    .click();
  await expect(table.locator("tbody tr")).toHaveCount(100);
  await expect(table).toContainText("Mẫu 100");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(table).toContainText("Mẫu 101");
  await expect(table).toContainText("Mẫu 200");
});

test("chat saved artifact opens the shared viewer with the exact version", async ({
  page,
}) => {
  await login(page);
  await page.goto("/chat?scenario=report-showcase&conversation=conv-report");
  const link = page.getByRole("link", { name: /View overview.*R019-v2/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.locator(".report-dashboard")).toHaveAttribute(
    "data-version",
    "R019-v2",
  );
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

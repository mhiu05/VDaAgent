import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";

const title = "Phân tích tồn kho — VDA Demo Riverside — đợt 1";
const errors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

async function login(
  page: Page,
  theme: "light" | "dark" = "light",
  locale: "vi" | "en" = "vi",
) {
  await page.addInitScript(
    ({ theme, locale }) => {
      const key = "vdaagent:v1:demo-user-01:preferences";
      if (!localStorage.getItem(key)) {
        localStorage.setItem(
          key,
          JSON.stringify({
            displayName: "Demo",
            locale,
            theme,
            timezone: "Asia/Bangkok",
            motion: "reduce",
            density: "comfortable",
            notifications: { reports: true, tasks: true, system: true },
            semanticExplanation: false,
          }),
        );
      }
    },
    { theme, locale },
  );
  await page.goto("/login");
  await page.getByRole("button", { name: /USER .*@vdaagent.test/ }).click();
  await page
    .getByRole("button", { name: "Vào không gian làm việc", exact: true })
    .click();
  await expect(page).toHaveURL("/");
}

function viewer(page: Page) {
  return page.getByRole("dialog", { name: title, exact: true });
}

async function selectedVersion(dialog: Locator, version = "R001-v2") {
  await expect(
    dialog.getByRole("combobox", { name: "Bản lưu bất biến", exact: true }),
  ).toHaveValue(version);
}

async function noOverflow(page: Page, dialog?: Locator) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  if (dialog) {
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height + 1,
    );
  }
}

test("card dashboard, full report and close preserve filtered library, scroll and focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto(
    "/reports?status=completed&sort=title&direction=asc&pageSize=25",
  );
  await expect(page.getByText("12 báo cáo", { exact: true })).toBeVisible();
  const trigger = page
    .locator(".report-cards")
    .getByRole("link", { name: title, exact: true });
  const href = await trigger.getAttribute("href");
  const target = new URL(href!, page.url());
  expect(target.pathname).toBe("/reports");
  expect(target.searchParams.get("report")).toBe("R001");
  expect(target.searchParams.get("version")).toBe("R001-v2");
  expect(target.searchParams.get("view")).toBe("dashboard");
  await trigger.scrollIntoViewIfNeeded();
  const listUrl = page.url();
  const scroll = await page.evaluate(() => window.scrollY);
  await trigger.click();
  const dialog = viewer(page);
  await expect(dialog).toBeVisible();
  await selectedVersion(dialog);
  await expect(dialog.locator(".report-dashboard")).toHaveAttribute(
    "data-version",
    "R001-v2",
  );
  await expect(dialog.locator(".report-kpis")).toContainText("Tồn khả dụng");
  await expect(dialog.locator(".report-kpis")).toContainText("60");
  await expect(dialog.locator(".report-document")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("view") === "detail",
  );
  await expect(dialog.locator(".report-document")).toContainText("R001-v2");
  await expect(
    dialog.getByRole("navigation", { name: "Mục lục", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Về tổng quan", exact: true })
    .click();
  await expect(dialog.locator(".report-document")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(listUrl);
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("combobox", { name: "Trạng thái", exact: true }),
  ).toHaveValue("completed");
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
});

test("version and view are reloadable and browser Back/Forward restore the selected saved document", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports?report=R001&version=R001-v1&view=dashboard");
  const dialog = viewer(page);
  await selectedVersion(dialog, "R001-v1");
  await dialog
    .getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true })
    .click();
  await expect(dialog.locator(".report-document")).toContainText("R001-v1");
  await dialog
    .getByRole("combobox", { name: "Bản lưu bất biến", exact: true })
    .selectOption("R001-v2");
  await expect(dialog.locator(".report-document")).toContainText("R001-v2");
  await page.goBack();
  await selectedVersion(dialog, "R001-v1");
  await expect(dialog.locator(".report-document")).toContainText("R001-v1");
  await page.goBack();
  await expect(
    dialog.getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(dialog.locator(".report-document")).toContainText("R001-v1");
  await page.goForward();
  await selectedVersion(dialog);
  await page.reload();
  await selectedVersion(viewer(page));
  await expect(viewer(page).locator(".report-document")).toContainText(
    "R001-v2",
  );
});

test("inventory and transaction dashboards expose selected-version chart values in accessible tables", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto("/reports?report=R001&version=R001-v1&view=dashboard");
  const inventory = viewer(page);
  await expect(inventory.locator(".report-dashboard")).toHaveAttribute(
    "data-version",
    "R001-v1",
  );
  await inventory
    .getByText("Bảng dữ liệu tương đương", { exact: true })
    .click();
  const ages = inventory.getByRole("table", {
    name: "Phân bố tuổi tồn kho · căn",
    exact: true,
  });
  await expect(
    ages.getByRole("row", { name: "0–89 ngày 24", exact: true }),
  ).toBeVisible();
  await expect(
    ages.getByRole("row", { name: "Chưa rõ tuổi 4", exact: true }),
  ).toBeVisible();
  await page.goto("/reports?report=R004&version=R004-v1&view=dashboard");
  const transactions = page.getByRole("dialog");
  await expect(transactions.locator(".report-dashboard")).toHaveAttribute(
    "data-version",
    "R004-v1",
  );
  await expect(transactions.locator(".report-kpis")).toContainText("24");
  await expect(transactions.locator(".report-kpis")).toContainText("28");
  await transactions
    .getByText("Bảng dữ liệu tương đương", { exact: true })
    .click();
  const days = transactions.getByRole("table", {
    name: "Giao dịch hoàn tất theo ngày · giao dịch/ngày",
    exact: true,
  });
  await expect(days.locator("tbody tr")).toHaveCount(25);
  const values = await days.locator("tbody td").allTextContents();
  const paging = transactions.getByRole("navigation", {
    name: "Giao dịch hoàn tất theo ngày · giao dịch/ngày · Phân trang báo cáo",
    exact: true,
  });
  await paging.getByRole("button", { name: "Sau", exact: true }).click();
  await expect(days.locator("tbody tr")).toHaveCount(5);
  await expect(paging.getByRole("status")).toHaveText("26–30 / 30");
  values.push(...(await days.locator("tbody td").allTextContents()));
  expect(values).toHaveLength(30);
  expect(values.reduce((total, value) => total + Number(value), 0)).toBe(24);
  await transactions
    .getByText("Bảng dữ liệu tương đương", { exact: true })
    .click();
  const lineChart = transactions.getByRole("region", {
    name: "Giao dịch hoàn tất theo ngày",
    exact: true,
  });
  await lineChart.scrollIntoViewIfNeeded();
  await noOverflow(page, transactions);
  await transactions.screenshot({
    path: testInfo.outputPath("transaction-desktop.png"),
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await lineChart.scrollIntoViewIfNeeded();
  await noOverflow(page, transactions);
  expect(
    await lineChart.evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);
  await lineChart.focus();
  await expect(lineChart).toBeFocused();
  const before = await lineChart.evaluate((el) => el.scrollLeft);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => lineChart.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(before);
  await lineChart.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await transactions.screenshot({
    path: testInfo.outputPath("transaction-mobile.png"),
  });
});

test("viewer traps keyboard focus and Escape returns to the card", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports?q=R001");
  const trigger = page
    .locator(".report-cards")
    .getByRole("link", { name: title, exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = viewer(page);
  await selectedVersion(dialog);
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press(index % 3 === 0 ? "Shift+Tab" : "Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL("/reports?q=R001");
  await expect(trigger).toBeFocused();
});

test("legacy direct report URL opens the selected full report in the same viewer", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports/R001?version=R001-v1");
  const dialog = viewer(page);
  await selectedVersion(dialog, "R001-v1");
  await expect(dialog.locator(".report-document")).toContainText("R001-v1");
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(page).toHaveURL("/reports");
  await expect(page.getByText("18 báo cáo", { exact: true })).toBeVisible();
});

test("English viewer controls preserve Vietnamese saved content and version identity", async ({
  page,
}) => {
  await login(page, "light", "en");
  await page.goto("/reports?report=R001&version=R001-v1&view=dashboard");
  const dialog = viewer(page);
  await expect(
    dialog.getByRole("combobox", {
      name: "Immutable saved versions",
      exact: true,
    }),
  ).toHaveValue("R001-v1");
  await dialog
    .getByRole("button", { name: "Read full report", exact: true })
    .click();
  await expect(dialog.locator(".report-document")).toHaveAttribute(
    "lang",
    "vi",
  );
  await expect(dialog.locator(".report-document")).toContainText("R001-v1");
  await dialog
    .getByRole("button", { name: "Back to dashboard", exact: true })
    .click();
  await expect(dialog.locator(".report-document")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Report library", exact: true }),
  ).toBeVisible();
});

test("downloads contain the selected immutable version and a failed download can be retried", async ({
  page,
}) => {
  await login(page);
  await page.goto(
    "/reports?scenario=error&report=R001&version=R001-v1&view=detail",
  );
  const dialog = viewer(page);
  await selectedVersion(dialog, "R001-v1");
  await dialog
    .getByRole("button", { name: "Tải CSV demo", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Chưa tải được artifact này",
  );
  for (const format of ["CSV", "HTML"]) {
    const pending = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: `Tải ${format} demo`, exact: true })
      .click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(
      `VDA-DEMO-R001-v1.${format.toLowerCase()}`,
    );
    const content = await fs.readFile((await download.path())!, "utf8");
    expect(content).toContain("R001-v1");
    expect(content).not.toContain("R001-v2");
  }
});

test("unfinished, invalid and unsupported artifact targets show recovery without invented output", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports?report=R017&view=dashboard");
  const unfinished = page.getByRole("dialog");
  await expect(
    unfinished.getByRole("heading", {
      name: "Chưa có phiên bản đã lưu",
      exact: true,
    }),
  ).toBeVisible();
  await expect(unfinished.locator(".report-document")).toHaveCount(0);
  await expect(
    unfinished.getByRole("button", { name: /Tải (HTML|CSV)/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/reports?report=R001&version=R002-v1&view=detail");
  await expect(page.getByRole("dialog")).toContainText(
    "Báo cáo hoặc phiên bản không khả dụng",
  );
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Thử lại", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(
    "/reports?scenario=unsupported-capability&report=R001&version=R001-v2&view=detail",
  );
  await expect(viewer(page)).toContainText(
    "Bản lưu này chưa có artifact để tải.",
  );
  await expect(
    viewer(page).getByRole("button", { name: /Tải (HTML|CSV)/ }),
  ).toHaveCount(0);
});

for (const scenario of [
  "report-no-chart",
  "report-no-kpi",
  "report-multiple-charts",
  "report-partial",
] as const) {
  test(`${scenario} keeps dashboard and full document consistent with the saved version`, async ({
    page,
  }) => {
    await login(page);
    await page.goto(
      `/reports?scenario=${scenario}&report=R001&version=R001-v2&view=dashboard`,
    );
    const dialog = viewer(page);
    await selectedVersion(dialog);
    const dashboard = dialog.locator(".report-dashboard");
    await expect(dashboard).toHaveAttribute("data-version", "R001-v2");
    if (scenario === "report-no-chart") {
      await expect(dashboard.locator(".chart-frame")).toHaveCount(0);
      await expect(dashboard.locator(".report-kpis")).toContainText("60");
    } else if (scenario === "report-no-kpi") {
      await expect(dashboard.locator(".report-kpis")).toHaveCount(0);
      await expect(dashboard.locator(".chart-frame")).toHaveCount(1);
    } else if (scenario === "report-multiple-charts") {
      await expect(dashboard.locator(".chart-frame")).toHaveCount(2);
    } else {
      await expect(
        dialog
          .locator(".report-viewer-header")
          .getByText("Dữ liệu chưa đầy đủ", { exact: true }),
      ).toBeVisible();
      await expect(
        dashboard
          .locator(".report-kpis > div")
          .filter({ hasText: "Chưa rõ tuổi" })
          .locator("strong"),
      ).toHaveText("—");
      await dashboard
        .getByText("Bảng dữ liệu tương đương", { exact: true })
        .click();
      await expect(
        dashboard
          .getByRole("table")
          .getByRole("row", { name: "Chưa rõ tuổi —", exact: true }),
      ).toBeVisible();
    }
    await dialog
      .getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true })
      .click();
    const document = dialog.locator(".report-document");
    await expect(document).toContainText("R001-v2");
    await expect(document.locator(".report-section-chart")).toHaveCount(
      scenario === "report-no-chart"
        ? 0
        : scenario === "report-multiple-charts"
          ? 2
          : 1,
    );
    await expect(document.locator(".report-section-metric-table")).toHaveCount(
      scenario === "report-no-kpi" ? 0 : 1,
    );
  });
}

test("failed regeneration keeps the prior saved version readable with an explicit warning", async ({
  page,
}) => {
  await login(page);
  await page.goto(
    "/reports?scenario=demo-replay&report=R001&version=R001-v2&view=dashboard",
  );
  const dialog = viewer(page);
  await selectedVersion(dialog);
  await expect(dialog).toContainText(
    "Lần tạo mới thất bại; bản lưu trước vẫn đọc được.",
  );
  await expect(dialog.locator(".report-dashboard")).toHaveAttribute(
    "data-version",
    "R001-v2",
  );
  await dialog
    .getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true })
    .click();
  await expect(dialog.locator(".report-document")).toContainText("R001-v2");
  await expect(
    dialog.getByRole("button", { name: "Tải HTML demo", exact: true }),
  ).toBeEnabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} report cards and both viewer modes reflow at phone, tablet and desktop sizes with accessible semantics`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await login(page, theme);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/reports?q=R001");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const trigger = page
        .locator(".report-cards")
        .getByRole("link", { name: title, exact: true });
      await expect(trigger).toBeVisible();
      await noOverflow(page);
      await trigger.click();
      const dialog = viewer(page);
      await selectedVersion(dialog);
      await noOverflow(page, dialog);
      await dialog.screenshot({
        path: testInfo.outputPath(`dashboard-${theme}-${width}.png`),
      });
      let audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      expect(
        audit.violations.map((violation) => ({
          id: violation.id,
          targets: violation.nodes.map((node) => node.target),
        })),
      ).toEqual([]);
      await dialog
        .getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true })
        .click();
      await expect(dialog.locator(".report-document")).toContainText("R001-v2");
      await noOverflow(page, dialog);
      await dialog.screenshot({
        path: testInfo.outputPath(`detail-${theme}-${width}.png`),
      });
      audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      expect(
        audit.violations.map((violation) => ({
          id: violation.id,
          targets: violation.nodes.map((node) => node.target),
        })),
      ).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL("/reports?q=R001");
      await expect(
        trigger,
        `${theme} ${width}px viewer restores its card focus`,
      ).toBeFocused();
    }
  });
}

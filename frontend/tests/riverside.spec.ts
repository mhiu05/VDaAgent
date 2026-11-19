import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
import path from "node:path";

const title = "Báo cáo phân tích tồn kho — Riverside, đợt 10";
const evidence = path.resolve("../docs/plan/evidence/riverside-r010-v2");
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

async function login(
  page: Page,
  theme: "light" | "dark" = "light",
  motion = "reduce",
) {
  await page.addInitScript(
    ({ theme, motion }) => {
      localStorage.setItem(
        "vdaagent:v1:demo-user-01:preferences",
        JSON.stringify({
          displayName: "Demo",
          locale: "vi",
          theme,
          timezone: "Asia/Bangkok",
          motion,
          density: "comfortable",
          notifications: { reports: true, tasks: true, system: true },
          semanticExplanation: false,
        }),
      );
    },
    { theme, motion },
  );
  await page.emulateMedia({
    reducedMotion: motion === "reduce" ? "reduce" : "no-preference",
  });
  await page.goto("/login");
  await page.getByRole("button", { name: /USER .*@vdaagent.test/ }).click();
  await page
    .getByRole("button", { name: "Vào không gian làm việc", exact: true })
    .click();
  await expect(page).toHaveURL("/");
}

async function open(page: Page) {
  await page.goto("/reports?q=R010&sort=title&direction=asc");
  const trigger = page
    .locator(".report-cards")
    .getByRole("link", { name: title, exact: true });
  await expect(trigger).toHaveCount(1);
  await expect(trigger).toHaveAttribute("href", /version=R010-v2/);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await expect(dialog.locator("#report-version")).toHaveValue("R010-v2");
  await expect(
    dialog.getByRole("heading", {
      name: "Tồn lâu tăng dù tổng tồn kho đã giảm",
      exact: true,
    }),
  ).toBeVisible();
  return { dialog, trigger };
}

async function bounds(page: Page, dialog: Locator) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + 1,
  );
  expect(
    await dialog
      .locator(".report-viewer-scroll")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
}

test("R010 list → overview → eight-section reader → history and pinned downloads", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto("/reports");
  await expect(page.getByText("18 báo cáo", { exact: true })).toBeVisible();
  const { dialog, trigger } = await open(page);
  await expect(dialog.locator(".report-kpis dd strong")).toHaveText([
    "60",
    "20",
    "35,7",
    "93,3",
  ]);
  await expect(dialog.locator(".report-kpi-comparison")).toHaveText([
    "−6 căn · so với mốc trước",
    "+2 căn · so với mốc trước",
    "+7,6 điểm % · so với mốc trước",
    "−3,6 điểm % · so với mốc trước",
  ]);
  await expect(dialog.locator(".report-version-bar")).toContainText(
    "Dữ liệu mô phỏng",
  );
  await expect(dialog.locator(".report-version-bar")).toContainText(
    "Đơn vị lập dự kiến: Report Agent",
  );
  await expect(dialog.locator(".report-version-bar")).toContainText("23:59");
  await expect(
    dialog.locator(".report-primary-finding .report-schema-finding"),
  ).toHaveCount(3);
  const chart = dialog.locator('[data-chart-id="age-distribution"]');
  await chart.getByRole("region").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(chart.locator(".chart-value-feedback")).toContainText("24 căn");
  await chart.locator("[data-chart-mark]").first().hover();
  await expect(chart.locator(".chart-value-feedback")).toContainText(
    "0–89 ngày",
  );
  await chart.locator(".report-chart-table summary").click();
  await expect(chart.locator("tbody tr")).toHaveText([
    "0–89 ngày24",
    "90–179 ngày12",
    "180–359 ngày14",
    "Từ 360 ngày6",
    "Chưa rõ tuổi4",
  ]);
  await chart.locator("select").selectOption("column");
  await expect(chart.locator("tbody tr")).toHaveCount(5);
  await chart.getByRole("button", { name: /^Phóng to:/ }).click();
  await expect(chart).toHaveAttribute("data-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(chart).not.toHaveAttribute("data-expanded", "true");
  await expect(dialog).toBeVisible();
  await chart.locator("select").selectOption("bar");
  const htmlEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Tải HTML", exact: true }).click();
  const html = await htmlEvent;
  expect(html.suggestedFilename()).toBe("R010-v2.html");
  const content = await fs.readFile((await html.path())!, "utf8");
  expect(content.match(/<h2>/g)).toHaveLength(8);
  expect(content).toContain("R010-v2");
  expect(content).not.toContain("R010-v1");
  const csvEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Tải CSV", exact: true }).click();
  const csv = await csvEvent;
  expect(csv.suggestedFilename()).toBe("R010-v2.csv");
  expect(await fs.readFile((await csv.path())!, "utf8")).toContain(
    '"Tỷ lệ tồn lâu","35.7","28.1","+7,6 điểm %"',
  );
  await dialog
    .getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true })
    .click();
  const toc = dialog.getByRole("navigation", { name: "Mục lục", exact: true });
  await expect(toc.getByRole("link")).toHaveCount(8);
  await expect(
    dialog.locator(".report-document > .report-block-grid > section > h2"),
  ).toHaveCount(8);
  await expect(dialog.locator(".report-document")).not.toContainText("09.");
  await expect(dialog.locator(".report-document")).toContainText(
    "Chênh lệch giảm 6 căn khả dụng không đồng nghĩa với 6 căn đã bán",
  );
  const fourth = toc.getByRole("link").nth(3);
  await fourth.click();
  await expect(fourth).toHaveAttribute("aria-current", "location");
  await expect(
    dialog.locator('[id="schema-document%2Fsection-04"]'),
  ).toBeFocused();
  expect(new URL(page.url()).hash).toBe("");
  await dialog
    .locator(".report-viewer-scroll")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(toc.getByRole("link").last()).toHaveAttribute(
    "aria-current",
    "location",
  );
  await dialog
    .getByRole("button", { name: "Về tổng quan", exact: true })
    .click();
  await expect(dialog.locator(".report-dashboard")).toBeVisible();
  await dialog.locator("#report-version").selectOption("R010-v1");
  await expect(dialog.locator(".report-dashboard")).toHaveAttribute(
    "data-version",
    "R010-v1",
  );
  const oldEvent = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Tải HTML demo", exact: true })
    .click();
  const old = await oldEvent;
  expect(old.suggestedFilename()).toBe("VDA-DEMO-R010-v1.html");
  expect(await fs.readFile((await old.path())!, "utf8")).toContain("R010-v1");
  await dialog.locator("#report-version").selectOption("R010-v2");
  await expect(dialog.locator(".report-dashboard")).toHaveAttribute(
    "data-version",
    "R010-v2",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.locator("#report-version")).toHaveValue("R010-v2");
  await page.reload();
  await expect(dialog.locator(".report-dashboard")).toHaveAttribute(
    "data-version",
    "R010-v2",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/q=R010/);
  await expect(page.locator(".report-result-heading > p")).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 1366, 768, 390, 320]) {
    test(`R010 responsive ${width}px ${theme}, table and reader accessibility`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width,
        height:
          width >= 1366
            ? width === 1440
              ? 900
              : 768
            : width === 768
              ? 1024
              : 844,
      });
      await login(page, theme);
      await fs.mkdir(evidence, { recursive: true });
      const { dialog } = await open(page);
      await bounds(page, dialog);
      await expect(dialog.locator(".report-kpis dd strong")).toHaveText([
        "60",
        "20",
        "35,7",
        "93,3",
      ]);
      if (width === 1440) {
        const scroll = (await dialog
          .locator(".report-viewer-scroll")
          .boundingBox())!;
        const findings = (await dialog
          .locator(".report-primary-finding")
          .boundingBox())!;
        expect(findings.y + findings.height).toBeLessThanOrEqual(
          scroll.y + scroll.height + 1,
        );
      }
      await page.screenshot({
        path: path.join(evidence, `overview-${width}-${theme}.png`),
      });
      const chart = dialog.locator('[data-chart-id="age-distribution"]');
      await chart.locator(".report-chart-table summary").click();
      await expect(chart.locator("tbody tr")).toHaveCount(5);
      await bounds(page, dialog);
      await chart.locator(".report-chart-table").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(evidence, `table-${width}-${theme}.png`),
      });
      await dialog
        .getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true })
        .click();
      await expect(
        dialog.getByRole("navigation", { name: "Mục lục" }).getByRole("link"),
      ).toHaveCount(8);
      await bounds(page, dialog);
      const audit = await new AxeBuilder({ page })
        .include(".report-viewer")
        .analyze();
      expect(audit.violations).toEqual([]);
      await page.screenshot({
        path: path.join(evidence, `reader-${width}-${theme}.png`),
      });
      await dialog
        .getByRole("navigation", { name: "Mục lục" })
        .getByRole("link")
        .nth(5)
        .click();
      await expect(
        dialog.locator('[id="schema-document%2Fsection-06"]'),
      ).toBeFocused();
      await bounds(page, dialog);
      await page.screenshot({
        path: path.join(evidence, `actions-${width}-${theme}.png`),
      });
    });
  }
}

test("R010 keyboard and enabled motion retain values and respect a live reduced-motion change", async ({
  page,
}) => {
  await login(page, "dark", "system");
  const { dialog } = await open(page);
  await expect(dialog.locator(".report-kpis dd strong")).toHaveText([
    "60",
    "20",
    "35,7",
    "93,3",
  ]);
  await dialog.locator("#report-version").focus();
  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await dialog
    .getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true })
    .click();
  await expect(
    dialog.getByRole("navigation", { name: "Mục lục" }).getByRole("link"),
  ).toHaveCount(8);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

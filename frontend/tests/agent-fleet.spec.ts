import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
import path from "node:path";

const evidence = path.resolve("../docs/plan/evidence/agent-fleet-v2");
const groupURL = "/chat?conversation=riverside-r010-group";
const issues = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  issues.set(page, []);
  page.on("pageerror", (e) => issues.get(page)!.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") issues.get(page)!.push(message.text());
  });
});
test.afterEach(({ page }) => expect(issues.get(page)).toEqual([]));

async function login(
  page: Page,
  theme: "light" | "dark" = "light",
  motion: "reduce" | "system" = "reduce",
) {
  await page.addInitScript(
    ({ theme, motion }) =>
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
      ),
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
  await page.goto(groupURL);
  await expect(page.locator(".timeline .message")).toHaveCount(10);
}
async function capture(page: Page, name: string) {
  await fs.mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: path.join(evidence, name),
    animations: "disabled",
  });
}
async function bounds(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const composer = (await page.locator(".composer-area").boundingBox())!;
  expect(composer.x).toBeGreaterThanOrEqual(0);
  expect(composer.x + composer.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  expect(composer.y + composer.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + 1,
  );
  expect(
    await page
      .locator(".timeline")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
}
async function audit(page: Page, selector = ".chat-layout") {
  const result = await new AxeBuilder({ page }).include(selector).analyze();
  expect(result.violations).toEqual([]);
}
async function dm(page: Page, name: string) {
  await page
    .locator(".docked-agent-list")
    .getByRole("button", { name: new RegExp(`^${name} `) })
    .click();
  await expect(page.locator(".conversation-header h2")).toHaveText(
    `${name} · Riverside`,
  );
  await expect(page.locator(".timeline .message")).toHaveCount(2);
}

test("ten public turns → scoped /report → existing R010-v2 reader → exact chat return, refresh and copy", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await login(page);
  const ids = await page
    .locator(".timeline .message")
    .evaluateAll((elements) =>
      elements.map((e) => e.getAttribute("data-message-id")),
    );
  expect(ids).toEqual(
    Array.from(
      { length: 10 },
      (_, i) => `r010-g-${String(i + 1).padStart(3, "0")}`,
    ),
  );
  await expect(page.locator(".fleet-mock-badge")).toHaveCount(1);
  const data = page.locator('[data-message-id="r010-g-003"]');
  await data.scrollIntoViewIfNeeded();
  await expect(data.locator(".report-kpis dd strong")).toHaveText([
    "60",
    "20",
    "35,7",
    "93,3",
  ]);
  await data.getByRole("button", { name: "Sao chép", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("20/56");
  const composer = page.getByRole("textbox", { name: "Tin nhắn", exact: true });
  await composer.fill("Câu hỏi mới chưa có trong kịch bản");
  await composer.press("Enter");
  await expect(page.getByText(/Đây là kịch bản đã ghi sẵn/)).toBeVisible();
  await expect(composer).toHaveValue("Câu hỏi mới chưa có trong kịch bản");
  await expect(page.locator(".timeline .message")).toHaveCount(10);
  await composer.fill("/report Green Park");
  await composer.press("Enter");
  await expect(page.getByText(/Yêu cầu này chưa có báo cáo/)).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await composer.fill("/report Riverside đợt 10");
    await composer.press("Enter");
    await expect(composer).toHaveValue("");
    await expect(page.locator('[data-message-id="r010-g-010"]')).toBeFocused();
    await expect(page.locator(".fleet-report-card")).toHaveCount(1);
    await expect(page.locator(".timeline .message")).toHaveCount(10);
  }
  const card = page.locator(".fleet-report-card");
  await expect(card).toContainText("Tồn lâu tăng dù tổng tồn kho đã giảm");
  await expect(card.locator(".fleet-report-meta")).toContainText("Đã hoàn tất");
  await expect(card).not.toContainText("Đã xuất bản");
  await card
    .getByRole("link", { name: "Xem báo cáo đầy đủ", exact: true })
    .click();
  await expect(page).toHaveURL(/report=R010&version=R010-v2/);
  const viewer = page.getByRole("dialog");
  await expect(viewer.locator("#report-version")).toHaveValue("R010-v2");
  await viewer
    .getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true })
    .click();
  await expect(
    viewer.locator(".report-document > .report-block-grid > section > h2"),
  ).toHaveCount(8);
  await expect(viewer.locator(".report-document [data-chart-id]")).toHaveCount(
    2,
  );
  await expect(viewer).toContainText("không đồng nghĩa với 6 căn đã bán");
  await capture(page, "agent-fleet-v2-09-report-viewer-r010-v2.png");
  await audit(page, ".report-viewer");
  await viewer
    .getByRole("button", { name: "Quay lại cuộc trò chuyện", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(groupURL);
  await expect(page.locator('[data-message-id="r010-g-010"]')).toBeFocused();
  await page.reload();
  await expect(page.locator(".timeline .message")).toHaveCount(10);
  await expect(page.locator(".fleet-report-card")).toHaveCount(1);
  await page
    .locator(".fleet-report-card")
    .getByRole("link", { name: "Xem báo cáo đầy đủ", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(groupURL);
  await expect(page.locator(".timeline .message")).toHaveCount(10);
});

test("six specialist DMs, details, tables, charts, keyboard mention, search and independent drafts", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const composer = page.getByRole("textbox", { name: "Tin nhắn", exact: true });
  await composer.fill("Bản nháp của group");
  const names = [
    "Orchestrator",
    "Data",
    "Compare",
    "Chart",
    "Insight",
    "Report",
  ];
  for (const [i, name] of names.entries()) {
    await dm(page, name);
    await expect(page.locator(".timeline")).not.toContainText("Hà Nội");
    await expect(page.locator(".timeline pre")).toHaveCount(0);
    if (name === "Data") {
      await expect(page.locator(".report-kpis dd strong")).toHaveText([
        "60",
        "20",
        "35,7",
        "93,3",
      ]);
      await page.getByText("Xem 5 nhóm tuổi tồn", { exact: true }).click();
      await expect(
        page
          .getByRole("table", { name: "Phân bố tuổi tồn", exact: true })
          .locator("tbody tr"),
      ).toHaveCount(5);
      await expect(page.locator(".fleet-details")).toContainText(
        "20/56 = 35,7%",
      );
      await composer.fill("Bản nháp Data");
    }
    if (name === "Compare") {
      await expect(page.locator(".timeline")).toContainText(
        "+7,6 điểm phần trăm",
      );
      await expect(
        page
          .getByRole("table", { name: "So sánh với mốc trước" })
          .locator("tbody tr"),
      ).toHaveCount(5);
    }
    if (name === "Chart") {
      const chart = page.locator('[data-chart-id="age-distribution"]');
      await expect(page.locator(".timeline svg.schema-chart")).toHaveCount(2);
      await chart.locator("[data-chart-mark]").first().hover();
      await expect(chart.locator(".chart-value-feedback")).toContainText(
        "24 căn",
      );
      await chart.locator(".schema-chart-scroll").focus();
      await page.keyboard.press("ArrowRight");
      await expect(chart.locator(".chart-value-feedback")).not.toBeEmpty();
      await chart.locator(".report-chart-table summary").click();
      await expect(chart.locator("tbody tr")).toHaveCount(5);
      await chart.getByRole("button", { name: /^Phóng to:/ }).click();
      await expect(chart).toHaveAttribute("data-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(chart).not.toHaveAttribute("data-expanded", "true");
    }
    if (name === "Insight") {
      await expect(page.locator('[data-block-kind="finding"]')).toHaveCount(3);
      await page
        .getByText("Kế hoạch hành động · 4 đề xuất P0–P2", { exact: true })
        .click();
      await expect(page.locator(".fleet-recommendation")).toHaveCount(4);
    }
    if (name === "Report")
      await expect(
        page.locator(".fleet-report-card .report-kpis dd strong"),
      ).toHaveText(["60", "20", "35,7", "93,3"]);
    await page.locator(".timeline").evaluate((el) => (el.scrollTop = 0));
    await bounds(page);
    await capture(
      page,
      `agent-fleet-v2-${String(i + 3).padStart(2, "0")}-dm-${name.toLowerCase()}.png`,
    );
    await audit(page);
  }
  await page.getByRole("button", { name: /^Riverside · Đợt 10/ }).click();
  await expect(composer).toHaveValue("Bản nháp của group");
  await composer.fill("@");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(5); // Insight retains its existing unsupported mention capability.
  await composer.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(composer).toHaveValue("@");
  await composer.fill("@Da");
  await composer.press("ArrowDown");
  await composer.press("Enter");
  await expect(composer).toHaveValue("@Data ");
  const before = await composer.evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  await composer.fill("Dòng 1\nDòng 2\nDòng 3\nDòng 4\nDòng 5");
  expect(
    await composer.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThan(before);
  await composer.press("Shift+Enter");
  await expect(page.locator(".timeline .message")).toHaveCount(10);
  await dm(page, "Data");
  await expect(composer).toHaveValue("Bản nháp Data");
  const search = page.getByRole("textbox", {
    name: "Tìm agent hoặc cuộc trò chuyện",
  });
  await search.fill("khong-ton-tai");
  await expect(
    page.getByText("Không tìm thấy cuộc trò chuyện.", { exact: true }),
  ).toBeVisible();
  await search.fill("compare");
  await expect(page.locator(".agent-row.agent-compare")).toBeVisible();
  await expect(page.locator(".agent-row.agent-data")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const)
  for (const width of [1440, 1366, 1120, 768, 390, 320]) {
    test(`Fleet responsive ${width}px ${theme}, drawers and theme preserve draft`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width >= 1120 ? 900 : 844 });
      await login(page, theme);
      const data = page.locator('[data-message-id="r010-g-003"]');
      await data.scrollIntoViewIfNeeded();
      await bounds(page);
      const composer = page.getByRole("textbox", {
        name: "Tin nhắn",
        exact: true,
      });
      await composer.fill(`Bản nháp ${width}`);
      const inspector = page.getByRole("button", {
        name: "Thông tin Agent",
        exact: true,
      });
      await inspector.click();
      if (width < 1440) {
        await expect(
          page.getByRole("dialog", { name: "Thông tin Agent", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("dialog").locator(".fleet-roster button"),
        ).toHaveCount(6);
        await page.keyboard.press("Escape");
        await expect(inspector).toBeFocused();
      }
      await expect(composer).toHaveValue(`Bản nháp ${width}`);
      if (width < 1024) {
        await page
          .getByRole("button", { name: "Agent Fleet", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /Data Khám phá/ })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.locator(".conversation-header h2")).toHaveText(
          "Data · Riverside",
        );
        await page
          .getByRole("button", { name: "Agent Fleet", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /^Riverside · Đợt 10/ })
          .click();
        await expect(composer).toHaveValue(`Bản nháp ${width}`);
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page
        .locator('[data-message-id="r010-g-003"]')
        .scrollIntoViewIfNeeded();
      if (width === 1440) await inspector.click();
      await bounds(page);
      await audit(page);
      await capture(page, `group-${width}-${theme}.png`);
      if (width === 1440)
        await capture(
          page,
          theme === "light"
            ? "agent-fleet-v2-01-group-light-1440.png"
            : "agent-fleet-v2-02-group-dark-1440.png",
        );
      if (theme === "light" && [768, 390, 320].includes(width))
        await capture(
          page,
          `agent-fleet-v2-${width === 390 ? "10-mobile-390" : width === 320 ? "11-mobile-320" : "12-tablet-768"}.png`,
        );
    });
  }

test("unrelated report commands in older chats and missing pinned versions remain truthful", async ({
  page,
}) => {
  await login(page);
  await page.goto("/chat");
  await expect(page.locator(".timeline .message").first()).toBeVisible();
  const count = await page.locator(".timeline .message").count();
  const input = page.getByRole("textbox", { name: "Tin nhắn", exact: true });
  await input.fill("/report Green Park");
  await input.press("Enter");
  await expect(page.getByText(/Yêu cầu này chưa có báo cáo/)).toBeVisible();
  await expect(page.locator(".timeline .message")).toHaveCount(count);
  await page.goto("/reports?report=R010&version=missing-version&view=detail");
  await expect(
    page
      .getByRole("dialog")
      .getByText("Báo cáo hoặc phiên bản không khả dụng", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".report-document")).toHaveCount(0);
});

for (const width of [390, 320])
  test(`mobile ${width}px chart interaction and report command return`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page);
    const menu = page.getByRole("button", { name: "Agent Fleet", exact: true });
    await menu.focus();
    await page.keyboard.press("Enter");
    await audit(page, ".overlay-panel");
    const chartAgent = page
      .getByRole("dialog")
      .getByRole("button", { name: /Chart Biến/ });
    await chartAgent.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".conversation-header h2")).toHaveText(
      "Chart · Riverside",
    );
    const chart = page.locator('[data-chart-id="age-distribution"]');
    await expect(chart.locator("svg.schema-chart")).toBeVisible();
    await chart.locator(".report-chart-table summary").click();
    await expect(chart.locator("tbody tr")).toHaveCount(5);
    await bounds(page);
    await capture(page, `mobile-chart-${width}.png`);
    const input = page.getByRole("textbox", { name: "Tin nhắn", exact: true });
    await input.fill("/report");
    await input.press("Enter");
    const viewer = page.getByRole("dialog");
    await expect(viewer.locator("#report-version")).toHaveValue("R010-v2");
    await viewer
      .getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true })
      .click();
    await expect(
      viewer.locator(".report-document > .report-block-grid > section > h2"),
    ).toHaveCount(8);
    await expect(
      viewer.locator(".report-document [data-chart-id]"),
    ).toHaveCount(2);
    await audit(page, ".report-viewer");
    await viewer
      .getByRole("button", { name: "Quay lại cuộc trò chuyện", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/conversation=riverside-dm-chart/);
    await expect(page.locator(".timeline .message")).toHaveCount(2);
    await bounds(page);
  });

test("enabled chart motion and a live reduced-motion change retain content and keyboard access", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "dark", "system");
  await dm(page, "Chart");
  await expect(page.locator(".timeline svg.schema-chart")).toHaveCount(2);
  await expect(page.locator("html")).toHaveAttribute("data-motion", "system");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await expect(page.locator(".timeline [data-animating]")).toHaveCount(0);
  expect(
    await page
      .locator(".agent-row")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  await expect(page.locator(".timeline svg.schema-chart")).toHaveCount(2);
  await page.getByRole("button", { name: /^Riverside · Đợt 10/ }).click();
  const insight = page.locator('[data-message-id="r010-g-006"]');
  await insight.scrollIntoViewIfNeeded();
  await capture(page, "group-dark-insight-1440.png");
  await audit(page);
});

/* global localStorage, window, performance, URL, document, innerWidth, getComputedStyle */
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath } from "node:url";

// Feature-owned browser journeys use the installed Playwright API. No second app/test config.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);
const artifacts = path.join(
  root,
  "docs/implementation/frontend/workspace-artifacts",
);
const baseURL = process.env.WORKSPACE_BASE_URL ?? "http://127.0.0.1:5173";
const executablePath = process.env.CHROME_PATH;
if (!executablePath)
  throw new Error(
    "Set CHROME_PATH to the Chromium executable used for verification.",
  );
await fs.mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
const journeyFilter = process.env.WORKSPACE_JOURNEY?.trim() ?? "";

async function journey(name, run) {
  if (journeyFilter && !name.includes(journeyFilter)) return;
  const start = performance.now();
  try {
    await run();
    results.push({
      name,
      status: "PASS",
      durationMs: performance.now() - start,
    });
    console.info(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      durationMs: performance.now() - start,
      error: String(error),
    });
    console.error(`FAIL ${name}: ${String(error).slice(0, 600)}`);
  }
}
async function pageFor(
  role = "USER",
  {
    width = 1440,
    height = 1000,
    theme = "light",
    locale = "vi",
    timezone = "Asia/Bangkok",
  } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  await context.addInitScript(
    ({ role, theme, locale, timezone }) => {
      const id = role === "USER" ? "demo-user-01" : "demo-admin-01";
      const key = `vdaagent:v1:${id}:preferences`;
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            displayName: "Demo",
            locale,
            theme,
            timezone,
            motion: "reduce",
            density: "comfortable",
            notifications: { reports: true, tasks: true, system: true },
            semanticExplanation: false,
          }),
        );
      window.__workspaceDownloads = { created: [], revoked: [] };
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        window.__workspaceDownloads.created.push({
          url,
          type: blob.type,
          size: blob.size,
        });
        return url;
      };
      URL.revokeObjectURL = (url) => {
        window.__workspaceDownloads.revoked.push(url);
        revoke(url);
      };
    },
    { role, theme, locale, timezone },
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseURL}/login`);
  await page
    .getByRole("button", { name: new RegExp(`${role} .*@vdaagent.test`) })
    .click();
  await page
    .getByRole("button", { name: "Vào không gian làm việc", exact: true })
    .click();
  await page.waitForURL(
    (url) => url.pathname === (role === "USER" ? "/" : "/admin/users"),
  );
  return { context, page, errors };
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
async function snap(page, name) {
  await page.screenshot({ path: path.join(artifacts, name), fullPage: await page.getByRole("dialog").count() === 0 });
}
async function audit(page, name) {
  const scope = await page.getByRole("dialog").count() ? '[role="dialog"]' : "#main-content";
  const result = await new AxeBuilder({ page })
    .include(scope)
    .analyze();
  const summary = {
    url: page.url(),
    scope,
    violations: result.violations,
    incomplete: result.incomplete.map((rule) => ({
      id: rule.id,
      impact: rule.impact,
      targets: rule.nodes.map((node) => node.target),
    })),
    passes: result.passes.length,
  };
  await fs.writeFile(
    path.join(artifacts, `a11y-${name}.json`),
    JSON.stringify(summary, null, 2) + "\n",
  );
  expect(result.violations).toEqual([]);
}

try {
  await journey(
    "USER dashboard totals, filters, chart table, inspect and focus restoration",
    async () => {
      const { page, context, errors } = await pageFor();
      try {
        await expect(page.locator('[data-metric="inventory"]')).toContainText(
          "120",
        );
        await expect(page.locator('[data-metric="slowShare"]')).toContainText(
          "31,6",
        );
        await expect(
          page.locator('[data-metric="transactions"]'),
        ).toContainText("45");
        await expect(page.getByText(/114\/120 căn đủ ngày/)).toBeVisible();
        await page
          .locator(".dashboard-charts figure")
          .first()
          .locator("summary")
          .click();
        await expect(
          page.getByRole("table", { name: "Phân bố tuổi tồn kho" }),
        ).toBeVisible();
        const unknown = page.getByRole("button", {
          name: "Chưa rõ tuổi 6",
          exact: true,
        });
        await unknown.click();
        await expect(page.locator(".dashboard-inspect tbody tr")).toHaveCount(
          6,
        );
        await page
          .getByRole("button", { name: "Đóng chi tiết", exact: true })
          .click();
        await expect(unknown).toBeFocused();
        await page
          .getByRole("combobox", { name: "Dự án", exact: true })
          .selectOption("P-A");
        await expect(page.locator('[data-metric="inventory"]')).toContainText(
          "60",
        );
        await expect(
          page.getByRole("link", { name: /4.*Báo cáo hoàn tất/ }),
        ).toBeVisible();
        await page.goBack();
        await expect(page.locator('[data-metric="inventory"]')).toContainText(
          "120",
        );
        await noOverflow(page);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "Reports full-scope filtering, no-match, history, refresh and draft lifecycle",
    async () => {
      const { page, context } = await pageFor();
      try {
        await page.goto(
          `${baseURL}/reports?status=completed&dateField=completedAt&from=2026-09-16&to=2026-10-16&timezone=Asia%2FBangkok`,
        );
        await expect(
          page.getByText("12 báo cáo", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("combobox", { name: "Loại báo cáo", exact: true })
          .selectOption("transactions");
        await expect(
          page.getByText("3 báo cáo", { exact: true }),
        ).toBeVisible();
        await page.goBack();
        await expect(
          page.getByText("12 báo cáo", { exact: true }),
        ).toBeVisible();
        await page.reload();
        await expect(
          page.getByText("12 báo cáo", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("searchbox", { name: "Tìm báo cáo", exact: true })
          .fill("zz-not-found");
        await page
          .getByRole("searchbox", { name: "Tìm báo cáo", exact: true })
          .press("Enter");
        await expect(
          page.getByRole("heading", { name: "Không có báo cáo khớp bộ lọc" }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Xóa bộ lọc", exact: true })
          .first()
          .click();
        await expect(
          page.getByText("18 báo cáo", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("combobox", { name: "Trạng thái", exact: true })
          .selectOption("draft");
        await expect(
          page.getByText("2 báo cáo", { exact: true }),
        ).toBeVisible();
        await page.locator('.report-cards a[href*="report=R017"]').click();
        await expect(
          page.getByRole("heading", { name: "Chưa có phiên bản đã lưu" }),
        ).toBeVisible();
        expect(
          await page.getByRole("button", { name: /Tải HTML/ }).count(),
        ).toBe(0);
        await page.goBack();
        await expect(
          page.getByText("2 báo cáo", { exact: true }),
        ).toBeVisible();
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "Selected saved version, TOC, actual HTML/CSV bytes, MIME and object URL cleanup",
    async () => {
      const { page, context } = await pageFor();
      try {
        await page.goto(`${baseURL}/reports/R001?version=R001-v1`);
        await expect(
          page.getByRole("combobox", { name: "Bản lưu bất biến" }),
        ).toHaveValue("R001-v1");
        await expect(page.locator(".report-document")).toContainText("R001-v1");
        for (const format of ["HTML", "CSV"]) {
          const waiting = page.waitForEvent("download");
          await page
            .getByRole("button", { name: `Tải ${format} demo`, exact: true })
            .click();
          const download = await waiting;
          expect(download.suggestedFilename()).toBe(
            `VDA-DEMO-R001-v1.${format.toLowerCase()}`,
          );
          const content = await fs.readFile(await download.path(), "utf8");
          expect(content).toContain("DEMO");
          expect(content).toContain("R001-v1");
          if (format === "HTML") expect(content).toMatch(/^<!doctype html>/);
          else expect(content).toContain("Ton kha dung,60");
        }
        await expect
          .poll(async () =>
            page.evaluate(() => window.__workspaceDownloads.revoked.length),
          )
          .toBe(2);
        expect(
          await page.evaluate(() =>
            window.__workspaceDownloads.created.map((item) => item.type),
          ),
        ).toEqual(["text/html;charset=utf-8", "text/csv;charset=utf-8"]);
        await page
          .getByRole("combobox", { name: "Bản lưu bất biến" })
          .selectOption("R001-v2");
        await expect(page.locator(".report-document")).toContainText("R001-v2");
        await page.goBack();
        await expect(
          page.getByRole("combobox", { name: "Bản lưu bất biến" }),
        ).toHaveValue("R001-v1");
        await page
          .getByRole("navigation", { name: "Mục lục" })
          .getByRole("link", { name: "Phương pháp", exact: true })
          .click();
        await expect(page.locator("#methodology")).toBeFocused();
        await expect(page.locator("#methodology")).toBeInViewport();
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "ADMIN confirmation, cancel, pessimistic status, filtered row, audit, enable and reset",
    async () => {
      const { page, context, errors } = await pageFor("ADMIN");
      try {
        await page
          .getByRole("combobox", { name: "Trạng thái tài khoản", exact: true })
          .selectOption("active");
        await expect(
          page.getByText("20 tài khoản USER", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", {
            name: /Nguyễn Minh Anh\s*demo.user.1@example.invalid/,
          })
          .click();
        await expect(page.locator(".admin-user-detail")).toContainText(
          "demo.user.1@example.invalid",
        );
        await page
          .getByRole("button", { name: "Mô phỏng vô hiệu hóa", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Hủy", exact: true }),
        ).toBeFocused();
        await page.getByRole("button", { name: "Hủy", exact: true }).click();
        await expect(
          page.getByText("20 tài khoản USER", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Mô phỏng vô hiệu hóa", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Xác nhận mô phỏng", exact: true })
          .click();
        await expect(
          page.getByText("Đã mô phỏng thay đổi trạng thái tài khoản.", {
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Đóng hồ sơ", exact: true })
          .click();
        await expect(
          page.getByText("19 tài khoản USER", { exact: true }),
        ).toBeVisible();
        await expect(
          page
            .getByRole("table", { name: "Lịch sử thao tác mô phỏng" })
            .locator("tbody tr"),
        ).toHaveCount(1);
        await page
          .getByRole("button", { name: "Mô phỏng kích hoạt", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Xác nhận mô phỏng", exact: true })
          .click();
        await expect(
          page.getByText("Đã mô phỏng thay đổi trạng thái tài khoản.", {
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Đóng hồ sơ", exact: true })
          .click();
        await expect(
          page
            .getByRole("table", { name: "Lịch sử thao tác mô phỏng" })
            .locator("tbody tr"),
        ).toHaveCount(2);
        await page
          .getByRole("button", { name: "Đặt lại phiên demo", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Đặt lại phiên demo", exact: true })
          .click();
        await expect(
          page.getByText("Chưa có thay đổi trong phiên demo này.", {
            exact: true,
          }),
        ).toBeVisible();
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "ADMIN failure/retry and revision conflict never claim false success",
    async () => {
      const { page, context } = await pageFor("ADMIN");
      try {
        await page.goto(`${baseURL}/admin/users?scenario=error`);
        await page
          .getByRole("button", {
            name: "Mô phỏng vô hiệu hóa demo.user.1@example.invalid",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "Xác nhận mô phỏng", exact: true })
          .click();
        await expect(
          page.getByText(/Thao tác chưa được xác nhận thành công/),
        ).toBeVisible();
        expect(
          await page
            .getByText("Đã mô phỏng thay đổi trạng thái tài khoản.", {
              exact: true,
            })
            .count(),
        ).toBe(0);
        await page
          .getByRole("button", { name: "Thử lại", exact: true })
          .click();
        await expect(
          page.getByText("Đã mô phỏng thay đổi trạng thái tài khoản.", {
            exact: true,
          }),
        ).toBeVisible();
        await page.goto(`${baseURL}/admin/users?scenario=out-of-order`);
        await page
          .getByRole("button", {
            name: "Mô phỏng vô hiệu hóa demo.user.1@example.invalid",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "Xác nhận mô phỏng", exact: true })
          .click();
        await expect(
          page.getByText(/Tài khoản đã có revision mới/),
        ).toBeVisible();
        expect(
          await page
            .getByText("Đã mô phỏng thay đổi trạng thái tài khoản.", {
              exact: true,
            })
            .count(),
        ).toBe(0);
        await page
          .getByRole("button", {
            name: "Xem lại trạng thái mới nhất",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("button", {
            name: "Mô phỏng kích hoạt demo.user.1@example.invalid",
            exact: true,
          }),
        ).toBeVisible();
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "Source errors, partial gaps, matched older version and unavailable artifacts",
    async () => {
      const { page, context } = await pageFor();
      try {
        await page.goto(`${baseURL}/?scenario=error`);
        await expect(
          page.locator('[data-metric="transactions"]'),
        ).toContainText("45");
        await expect(
          page.getByRole("link", { name: /12.*Báo cáo hoàn tất/ }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Thử lại", exact: true })
          .first()
          .click();
        await expect(page.locator('[data-metric="inventory"]')).toContainText(
          "120",
        );
        await page.goto(`${baseURL}/?scenario=interrupted`);
        await expect(
          page.locator('[data-metric="transactions"]'),
        ).toContainText("Chưa đủ dữ liệu");
        await expect(
          page.getByText(/Ngày thiếu nguồn là khoảng trống/),
        ).toBeVisible();
        await page.goto(
          `${baseURL}/reports?scenario=out-of-order&status=completed&dateField=completedAt&from=2026-09-16&to=2026-10-16`,
        );
        await expect(
          page.getByText("12 báo cáo", { exact: true }),
        ).toBeVisible();
        await expect(
          page.locator('.report-cards a[href*="report=R001"][href*="version=R001-v1"]'),
        ).toBeVisible();
        await page.goto(
          `${baseURL}/reports/R001?scenario=unsupported-capability&version=R001-v2`,
        );
        await expect(
          page.getByText("Bản lưu này chưa có artifact để tải.", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Tóm tắt điều hành", exact: true }),
        ).toBeVisible();
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "10,000-row repositories paginate bounded DOM and search the full data scope",
    async () => {
      const { page, context } = await pageFor();
      try {
        await page.goto(`${baseURL}/reports?scenario=performance`);
        await expect(
          page.getByText("10000 báo cáo", { exact: true }),
        ).toBeVisible();
        await expect(
          page.locator(".report-cards > li"),
        ).toHaveCount(25);
        await page.getByRole("button", { name: "Sau", exact: true }).click();
        await expect(page).toHaveURL(/page=2/);
        await expect(
          page.locator(".report-cards > li"),
        ).toHaveCount(25);
        await page
          .getByRole("searchbox", { name: "Tìm báo cáo", exact: true })
          .fill("9999");
        await page
          .getByRole("searchbox", { name: "Tìm báo cáo", exact: true })
          .press("Enter");
        await expect(
          page.getByText("1 báo cáo", { exact: true }),
        ).toBeVisible();
        await expect(page.locator(".report-cards h2")).toContainText("9999");
      } finally {
        await context.close();
      }
    },
  );
  for (const theme of ["light", "dark"])
    for (const width of [1440, 390]) {
      await journey(
        `Visual/reflow ${theme} ${width}px with keyboard and reduced motion`,
        async () => {
          const { page, context, errors } = await pageFor("USER", {
            width,
            height: width === 390 ? 844 : 1000,
            theme,
          });
          try {
            await expect(
              page.locator('[data-metric="inventory"]'),
            ).toContainText("120");
            await noOverflow(page);
            await snap(page, `dashboard-${theme}-${width}.png`);
            await audit(page, `dashboard-${theme}-${width}`);
            await page.goto(`${baseURL}/reports`);
            await expect(
              page.getByText("18 báo cáo", { exact: true }),
            ).toBeVisible();
            await noOverflow(page);
            await snap(page, `reports-${theme}-${width}.png`);
            await audit(page, `reports-${theme}-${width}`);
            await page.goto(`${baseURL}/reports/R001?version=R001-v2`);
            await expect(page.locator(".report-document")).toContainText(
              "Tóm tắt điều hành",
            );
            await noOverflow(page);
            await snap(page, `report-detail-${theme}-${width}.png`);
            await audit(page, `report-detail-${theme}-${width}`);
            expect(
              await page.evaluate(
                () => getComputedStyle(document.documentElement).scrollBehavior,
              ),
            ).not.toBe("smooth");
            expect(errors).toEqual([]);
          } finally {
            await context.close();
          }
          const admin = await pageFor("ADMIN", {
            width,
            height: width === 390 ? 844 : 1000,
            theme,
          });
          try {
            await expect(
              admin.page.getByText("24 tài khoản USER", { exact: true }),
            ).toBeVisible();
            await noOverflow(admin.page);
            await snap(admin.page, `admin-${theme}-${width}.png`);
            await audit(admin.page, `admin-${theme}-${width}`);
          } finally {
            await admin.context.close();
          }
        },
      );
    }
  await journey(
    "English feature namespaces and direct-route role exclusivity",
    async () => {
      const { page, context } = await pageFor("USER", { locale: "en" });
      try {
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: "Analytics overview",
            exact: true,
          }),
        ).toBeVisible();
        await page.goto(`${baseURL}/reports`);
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: "Report library",
            exact: true,
          }),
        ).toBeVisible();
        await page.goto(`${baseURL}/admin/users`);
        await expect(
          page.getByRole("searchbox", { name: "Search users" }),
        ).toHaveCount(0);
      } finally {
        await context.close();
      }
      const admin = await pageFor("ADMIN", {
        locale: "en",
        timezone: "America/Los_Angeles",
      });
      try {
        await expect(
          admin.page.getByRole("heading", {
            level: 1,
            name: "User management",
            exact: true,
          }),
        ).toBeVisible();
        const time = admin.page
          .locator(".admin-users-workspace table time")
          .first();
        await expect(time).toBeVisible();
        const instant = await time.getAttribute("datetime");
        const expected = await admin.page.evaluate(
          (instant) =>
            new Intl.DateTimeFormat("en-US", {
              dateStyle: "medium",
              timeZone: "America/Los_Angeles",
            }).format(new Date(instant)),
          instant,
        );
        await expect(time).toHaveText(expected);
        await admin.page.goto(`${baseURL}/reports`);
        await expect(
          admin.page.getByRole("searchbox", { name: "Search reports" }),
        ).toHaveCount(0);
      } finally {
        await admin.context.close();
      }
    },
  );
  await journey(
    "Notification report target resolves through the report dashboard and keeps unavailable-target recovery",
    async () => {
      const { page, context } = await pageFor();
      try {
        await page.goto(`${baseURL}/notifications`);
        await page
          .getByRole("button", {
            name: "Mở chi tiết: Bản tổng hợp nghiên cứu đã sẵn sàng",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "Đến nội dung liên quan", exact: true })
          .click();
        await expect(page).toHaveURL(url => url.pathname === '/reports' && url.searchParams.get('report') === 'report-market-demo');
        await expect(page.getByRole("dialog")).toContainText(
          "VDA-DEMO-R001",
        );
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true })
          .click();
        await expect(page.locator(".report-document")).toContainText("R001-v2");
        await page.goto(`${baseURL}/notifications`);
        await page
          .getByRole("button", {
            name: "Mở chi tiết: Nguồn tham chiếu không còn khả dụng",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "Đến nội dung liên quan", exact: true })
          .click();
        await expect(page.locator(".notification-detail")).toContainText(
          "Đích đến không tồn tại, bị giới hạn hoặc đang chờ tích hợp workspace.",
        );
        await expect(page).toHaveURL(/\/notifications$/);
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "Leaving Dashboard during catalog loading cannot reclaim navigation with storage unavailable",
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(`${baseURL}/login?scenario=storage-unavailable`);
        await page
          .getByRole("button", { name: /USER .*@vdaagent.test/ })
          .click();
        await page
          .getByRole("button", { name: "Vào không gian làm việc", exact: true })
          .click();
        await expect(page).toHaveURL(`${baseURL}/`);
        await page.locator('.system-links a[href="/chat"]').click();
        await expect(
          page.getByRole("textbox", { name: "Tin nhắn", exact: true }),
        ).toBeVisible();
        await expect(page).toHaveURL((url) => url.pathname === "/chat");
        await page
          .getByRole("textbox", { name: "Tin nhắn", exact: true })
          .fill("Memory fallback from workspace regression");
        await page
          .getByRole("button", { name: "Gửi tin nhắn", exact: true })
          .click();
        await expect(page.locator(".message-user").last()).toContainText(
          "Memory fallback from workspace regression",
        );
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "Dashboard to filtered library to selected saved report and actual download",
    async () => {
      const { page, context } = await pageFor();
      try {
        await expect(page.locator('[data-metric="inventory"]')).toContainText(
          "120",
        );
        await page
          .locator('.activity-overview a[href^="/reports?"]')
          .click();
        await expect(
          page.getByText("12 báo cáo", { exact: true }),
        ).toBeVisible();
        await expect(page).toHaveURL(/dateField=completedAt/);
        await page.locator('.report-cards a[href*="report=R001"][href*="version=R001-v2"]').click();
        await expect(
          page.getByRole("combobox", { name: "Bản lưu bất biến" }),
        ).toHaveValue("R001-v2");
        await page.getByRole('dialog').getByRole('button', { name: 'Xem báo cáo đầy đủ', exact: true }).click();
        const waiting = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "Tải CSV demo", exact: true })
          .click();
        const download = await waiting;
        expect(download.suggestedFilename()).toBe("VDA-DEMO-R001-v2.csv");
        expect(await fs.readFile(await download.path(), "utf8")).toContain(
          "R001-v2",
        );
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "Saved Core settings control Workspace locale and display timezone without changing KPI scope",
    async () => {
      const { page, context } = await pageFor();
      try {
        await page.goto(`${baseURL}/setting`);
        await page.getByLabel("Ngôn ngữ", { exact: true }).selectOption("en");
        await page.getByLabel("IANA timezone").fill("Pacific/Kiritimati");
        await page
          .getByRole("button", { name: "Save changes", exact: true })
          .click();
        await expect(
          page.getByText("Preferences saved", { exact: true }),
        ).toBeVisible();
        await page.locator('.system-links a[href="/"]').click();
        await expect(page.locator('[data-metric="slowShare"]')).toContainText(
          "31.6",
        );
        await expect(page.locator('[data-metric="inventory"]')).toContainText(
          "120",
        );
        await expect(page.locator(".dashboard-calendar")).toContainText(
          "Asia/Bangkok",
        );
        await page.goto(`${baseURL}/reports/R001?version=R001-v2`);
        const date = page.locator(".report-snapshot time").first();
        const instant = await date.getAttribute("datetime");
        const expected = await page.evaluate(
          (instant) =>
            new Intl.DateTimeFormat("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Pacific/Kiritimati",
            }).format(new Date(instant)),
          instant,
        );
        await expect(date).toHaveText(expected);
        await page.reload();
        await expect(date).toHaveText(expected);
        await expect(page.getByRole("dialog")).toHaveAccessibleName(
          "Phân tích tồn kho — VDA Demo Riverside — đợt 1",
        );
        const externalLinks = await page
          .locator('a[href^="http"]')
          .evaluateAll((links) => links.map((link) => link.href));
        expect(externalLinks.every((url) => /^https?:\/\//.test(url))).toBe(
          true,
        );
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "Mobile ADMIN response-loss reconciliation records one audit operation",
    async () => {
      const { page, context } = await pageFor("ADMIN", {
        width: 390,
        height: 844,
      });
      try {
        await page.goto(`${baseURL}/admin/users?scenario=unknown-ack`);
        await page
          .getByRole("button", {
            name: "Mô phỏng vô hiệu hóa demo.user.1@example.invalid",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("button", { name: "Hủy", exact: true }),
        ).toBeFocused();
        await page
          .getByRole("button", { name: "Xác nhận mô phỏng", exact: true })
          .click();
        await expect(
          page.getByText("Đã mô phỏng thay đổi trạng thái tài khoản.", {
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Đóng hồ sơ", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Xem hồ sơ demo.user.1@example.invalid",
            exact: true,
          })
          .click();
        const audit = page.getByRole("table", {
          name: "Lịch sử thao tác mô phỏng",
          exact: true,
        });
        await expect(audit.locator("tbody tr")).toHaveCount(1);
        await expect(
          page.getByRole("button", { name: "Mô phỏng kích hoạt", exact: true }),
        ).toBeVisible();
        await noOverflow(page);
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "Report dashboard history returns to the creating list and mobile targets share the same viewer",
    async () => {
      const { page, context } = await pageFor();
      try {
        await page.goto(`${baseURL}/reports`);
        await expect(
          page.getByText("18 báo cáo", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("combobox", { name: "Trạng thái", exact: true })
          .selectOption("completed");
        await expect(
          page.getByText("12 báo cáo", { exact: true }),
        ).toBeVisible();
        const before = page.url();
        const trigger = page.locator('.report-cards a[href*="report=R001"]');
        await trigger.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Đóng", exact: true })
          .click();
        await expect(page).toHaveURL(before);
        await expect(trigger).toBeFocused();
        await page.goBack();
        await expect(
          page.getByText("18 báo cáo", { exact: true }),
        ).toBeVisible();
        await page.goto(`${baseURL}/reports?report=R001&version=R001-v1`);
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Đóng", exact: true })
          .click();
        await expect(page).toHaveURL(`${baseURL}/reports`);
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(
          page.getByRole("button", { name: /Xem nhanh/ }),
        ).toHaveCount(0);
        await page.goto(
          `${baseURL}/reports?status=completed&report=R001&version=R001-v1`,
        );
        await expect(page).toHaveURL(url => url.pathname === '/reports' && url.searchParams.get('report') === 'R001' && url.searchParams.get('version') === 'R001-v1');
        await expect(
          page.getByRole("combobox", { name: "Bản lưu bất biến" }),
        ).toHaveValue("R001-v1");
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Đóng", exact: true })
          .click();
        await expect(page).toHaveURL(`${baseURL}/reports?status=completed`);
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "Custom business timezone is accurately labeled and incomplete certified coverage stays unknown",
    async () => {
      const { page, context } = await pageFor();
      try {
        await page.goto(`${baseURL}/?timezone=America%2FNew_York`);
        await expect(page.locator(".dashboard-calendar")).toContainText(
          "America/New_York",
        );
        await expect(
          page.locator('[data-metric="transactions"]'),
        ).toContainText("Chưa đủ dữ liệu");
        await expect(page.locator('[data-metric="inventory"]')).toContainText(
          "Chưa đủ dữ liệu",
        );
      } finally {
        await context.close();
      }
    },
  );
  await journey(
    "320px, tablet and wide viewport reflow plus long report anchors",
    async () => {
      for (const width of [320, 768, 1920]) {
        const { page, context } = await pageFor("USER", {
          width,
          height: 1000,
        });
        try {
          await expect(page.locator('[data-metric="inventory"]')).toContainText(
            "120",
          );
          await noOverflow(page);
          await page.goto(`${baseURL}/reports`);
          await expect(
            page.getByText("18 báo cáo", { exact: true }),
          ).toBeVisible();
          await noOverflow(page);
          await page.goto(
            `${baseURL}/reports/R001?scenario=long-conversation&version=R001-v2`,
          );
          await expect(
            page.locator(".report-document>.report-section"),
          ).toHaveCount(30);
          await noOverflow(page);
          await page
            .getByRole("navigation", { name: "Mục lục" })
            .getByRole("link", {
              name: "Phụ lục 20: Đối chiếu dữ liệu",
              exact: true,
            })
            .click();
          await expect(page.locator("#appendix-20")).toBeFocused();
          await expect(page.locator("#appendix-20")).toBeInViewport();
          if (width === 768)
            await page.screenshot({
              path: path.join(artifacts, "long-report-tablet.png"),
            });
        } finally {
          await context.close();
        }
      }
    },
  );
} finally {
  await browser.close();
  const report = {
    baseURL,
    browser: "Chromium",
    filter: journeyFilter || null,
    results,
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results.filter((r) => r.status === "FAIL").length,
  };
  await fs.writeFile(
    path.join(artifacts, journeyFilter ? `workspace-browser-results-${journeyFilter.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.json` : "workspace-browser-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.info(`${report.passed} passed, ${report.failed} failed`);
  if (!results.length) console.error(`No workspace journeys matched: ${journeyFilter}`);
  process.exitCode = report.failed || !results.length ? 1 : 0;
}

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import fs from "node:fs";
const artifact = path.resolve("../docs/implementation/frontend/artifacts");
fs.mkdirSync(artifact, { recursive: true });
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});
async function login(page: Page, role = "USER", scenario = "") {
  await page.goto(`/login${scenario ? `?scenario=${scenario}` : ""}`);
  await page.getByRole("button", { name: role, exact: false }).click();
  await page.getByRole("button", { name: "Vào không gian làm việc" }).click();
  await expect(page).toHaveURL(role === "ADMIN" ? "/admin/users" : "/");
}
async function chat(page: Page, scenario = "") {
  await login(page, "USER");
  await page.goto(`/chat${scenario ? `?scenario=${scenario}` : ""}`);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Góc nhìn thị trường nhà ở",
      exact: true,
    }),
  ).toBeVisible();
}
test("USER draft, send, reload and agent selection", async ({ page }) => {
  await chat(page);
  const textbox = page.getByRole("textbox", { name: "Tin nhắn", exact: true });
  await textbox.fill("Bản nháp giữ nguyên");
  await page.getByRole("button", { name: /Data Khám phá/ }).click();
  await page.getByRole("button", { name: /Orchestrator Kết nối/ }).click();
  await expect(textbox).toHaveValue("Bản nháp giữ nguyên");
  await page.reload();
  await expect(textbox).toHaveValue("Bản nháp giữ nguyên");
  await textbox.press("Enter");
  await expect(page.locator(".message-user").last()).toContainText(
    "Bản nháp giữ nguyên",
  );
  await expect(textbox).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Gửi tin nhắn", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".message-agent")).toHaveCount(2);
});
test("ADMIN has no USER navigation and all user routes are denied", async ({
  page,
}) => {
  await login(page, "ADMIN");
  for (const url of [
    "/",
    "/chat",
    "/reports",
    "/reports/x",
    "/notifications",
    "/setting",
  ]) {
    await page.goto(url);
    await expect(
      page.getByText("Bạn không có quyền truy cập trang này"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Trợ lý agent", exact: true }),
    ).toHaveCount(0);
  }
  await page.locator(".system-sidebar").hover();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(page).toHaveURL("/login");
});
test("notifications mark read, open integrated report and preserve unavailable target recovery", async ({
  page,
}) => {
  await login(page);
  await page.goto("/notifications");
  await page.getByRole("button", { name: /Mở chi tiết: Bản tổng hợp/ }).click();
  await page.getByRole("button", { name: "Đến nội dung liên quan" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/reports" &&
      url.searchParams.get("report") === "report-market-demo",
  );
  await expect(page.getByRole("dialog")).toContainText("VDA-DEMO-R001");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Xem báo cáo đầy đủ", exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("view") === "detail" &&
      url.searchParams.get("version") === "R001-v2",
  );
  await expect(page.locator(".report-document")).toContainText("R001-v2");
  await page.goto("/notifications");
  await page
    .getByRole("button", {
      name: "Mở chi tiết: Nguồn tham chiếu không còn khả dụng",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Đến nội dung liên quan" }).click();
  await expect(
    page.getByText(
      "Đích đến không tồn tại, bị giới hạn hoặc đang chờ tích hợp workspace.",
    ),
  ).toBeVisible();
  await expect(page).toHaveURL("/notifications");
  await page.getByRole("button", { name: "Đánh dấu tất cả đã đọc" }).click();
  await expect(
    page.getByRole("button", { name: "Đánh dấu tất cả đã đọc" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Chưa đọc/ }).click();
  await expect(page.getByText("Bạn đã đọc tất cả thông báo.")).toBeVisible();
});
test("settings preview, cancel, save, dirty navigation, timezone and locale", async ({
  page,
}) => {
  await login(page);
  await page.goto("/setting");
  await page.getByRole("radio", { name: "Tối" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Lưu thay đổi", exact: true })).toBeDisabled();
  await page.getByLabel("Tên hiển thị").fill("Nghiên cứu Demo");
  await page
    .locator(".system-links")
    .getByRole("link", { name: "Trợ lý agent", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Rời trang và bỏ thay đổi?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ở lại trang" }).click();
  await page.locator("#timezone").fill("UTC");
  await page.getByLabel("Ngôn ngữ", { exact: true }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Preferences saved")).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByLabel("IANA timezone")).toHaveValue("UTC");
});
test("mobile drawer Escape returns focus and composer stays visible at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await chat(page);
  const trigger = page.getByRole("button", {
    name: "Agent Fleet",
    exact: true,
  });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Agent Fleet" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(artifact, "chat-mobile-light.png"),
    fullPage: true,
  });
});
test("replay labeling and cancellation reflect mock ACK", async ({ page }) => {
  await chat(page, "demo-replay");
  await page
    .getByRole("textbox", { name: "Tin nhắn", exact: true })
    .fill("Replay this demo");
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Dừng phát lại" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dừng phát lại" }).click();
  await expect(page.getByText("Đã dừng phát lại")).toBeVisible();
});
test("offline preserves draft and unsupported capability hides attachment", async ({
  page,
}) => {
  await chat(page, "offline");
  await page
    .getByRole("textbox", { name: "Tin nhắn", exact: true })
    .fill("Offline draft");
  await expect(
    page.getByRole("button", { name: "Gửi tin nhắn", exact: true }),
  ).toBeDisabled();
  await page.goto("/chat?scenario=unsupported-capability");
  await expect(
    page.getByRole("button", { name: "Đính kèm tệp minh họa", exact: true }),
  ).toHaveCount(0);
});
test("long timeline prepend preserves anchor, jump remains explicit", async ({
  page,
}) => {
  await chat(page, "long-conversation");
  const timeline = page.locator(".timeline");
  await timeline.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.getByRole("button", { name: "Tải 50 tin trước" }).click();
  await expect(page.locator(".message")).toHaveCount(80);
  expect(await timeline.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Về tin nhắn mới nhất" }).click();
  await expect
    .poll(() =>
      timeline.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
      ),
    )
    .toBeLessThan(80);
  await expect(
    page.getByRole("button", { name: "Về tin nhắn mới nhất" }),
  ).toHaveCount(0);
});
test("screenshots and axe in both themes across core pages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Vào không gian làm việc" }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(artifact, "login-light.png"),
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole("combobox", { name: "Cài đặt", exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: path.join(artifact, "login-dark.png"),
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await login(page);
  for (const theme of ["light", "dark"]) {
    await page.goto("/setting");
    await page
      .getByRole("radio", {
        name: theme === "light" ? "Sáng" : "Tối",
        exact: true,
      })
      .check();
    if (await page.getByRole("button", { name: "Lưu thay đổi" }).isEnabled()) {
      await page.getByRole("button", { name: "Lưu thay đổi" }).click();
      await expect(page.getByText("Tùy chọn đã được lưu")).toBeVisible();
    }
    for (const route of ["chat", "notifications", "setting"]) {
      await page.goto(`/${route}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
      if (route === "chat")
        await expect(
          page.getByRole("textbox", { name: "Tin nhắn", exact: true }),
        ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.screenshot({
        path: path.join(artifact, `${route}-${theme}.png`),
        fullPage: true,
      });
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    }
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/chat");
    await expect(
      page.getByRole("textbox", { name: "Tin nhắn", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(artifact, `chat-mobile-${theme}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

test("attachments require reattachment after reload and reset restores fixtures", async ({
  page,
}) => {
  await chat(page);
  await page
    .getByRole("textbox", { name: "Tin nhắn", exact: true })
    .fill("Kiểm tra tệp minh họa");
  await page.locator("input[type=file]").setInputFiles({
    name: "sample.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("city,value\nHanoi,68"),
  });
  await expect(page.locator(".attachment-list")).toContainText("sample.csv");
  await page.reload();
  await expect(page.locator(".attachment-list")).toContainText(
    "Cần đính kèm lại",
  );
  await expect(
    page.getByRole("button", { name: "Gửi tin nhắn", exact: true }),
  ).toBeDisabled();
  await page.goto("/setting");
  await page
    .getByRole("button", { name: "Đặt lại dữ liệu minh họa", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Đặt lại dữ liệu minh họa", exact: true })
    .click();
  await expect(page.getByText("Đã đặt lại dữ liệu minh họa")).toBeVisible();
  await page.goto("/chat");
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn", exact: true }),
  ).toHaveValue("");
  await expect(page.locator(".attachment-list")).toHaveCount(0);
});

test("demo groups, keyboard mentions, source disclosure and one modal", async ({
  page,
}) => {
  await chat(page);
  await page
    .getByRole("button", { name: "Tạo nhóm minh họa", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Orchestrator", exact: true })
    .check();
  await page.getByRole("checkbox", { name: "Data", exact: true }).check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tạo nhóm minh họa", exact: true })
    .click();
  await expect(page.locator(".conversation-header")).toContainText(
    "Nhóm minh họa",
  );
  const input = page.getByRole("textbox", { name: "Tin nhắn", exact: true });
  await input.fill("@Da");
  await expect(page.getByRole("listbox")).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue("@Data ");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.locator(".message")).toHaveCount(0);
  await page.getByRole("button", { name: /Orchestrator Kết nối/ }).click();
  await page.getByRole("button", { name: /2 Baseline/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Nguồn này không còn khả dụng.",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("expired sessions and corrupt storage never mount protected content", async ({
  page,
}) => {
  await chat(page);
  await page.evaluate(() => {
    const key = "vdaagent:v1:public:session";
    const s = JSON.parse(sessionStorage.getItem(key)!);
    s.expiresAt = "2000-01-01T00:00:00Z";
    sessionStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  await expect(page).toHaveURL("/login");
  await expect(
    page.getByText("Phiên minh họa đã hết hạn. Đăng nhập để tiếp tục."),
  ).toBeVisible();
  await page.evaluate(() =>
    sessionStorage.setItem("vdaagent:v1:public:session", "{corrupt"),
  );
  await page.goto("/chat");
  await expect(page).toHaveURL("/login");
  await expect(page.locator(".timeline")).toHaveCount(0);
});

test("storage unavailable stays usable and settings failure preserves preview draft", async ({
  page,
}) => {
  await login(page, "USER", "storage-unavailable");
  await page.locator('.system-links a[href="/chat"]').click();
  await expect(page.locator("textarea")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Tin nhắn", exact: true })
    .fill("Memory fallback");
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  await expect(page.locator(".message-user").last()).toContainText(
    "Memory fallback",
  );
  await expect(page.getByText(/Bộ nhớ không khả dụng/).first()).toBeVisible();
  await page.goto("/login");
  await page.getByRole("button", { name: "USER", exact: false }).click();
  await page.getByRole("button", { name: "Vào không gian làm việc" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/setting?scenario=error");
  await page.getByLabel("Tên hiển thị").fill("Bản nháp khi lỗi");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Chưa lưu được thay đổi");
  await expect(page.getByLabel("Tên hiển thị")).toHaveValue("Bản nháp khi lỗi");
});

test("responsive locale and reduced-motion matrix has no page overflow", async ({
  page,
}) => {
  await login(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/setting");
  await page.getByLabel("Ngôn ngữ", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Preferences saved")).toBeVisible();
  for (const width of [320, 360, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/chat");
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeInViewport();
    if (width === 1024) {
      await page
        .getByRole("button", { name: "Agent details", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(
        await page
          .locator(".overlay-panel")
          .evaluate((el) => getComputedStyle(el).animationName),
      ).toBe("none");
      await page.keyboard.press("Escape");
    }
    if (width === 1440) {
      const before = await page.locator(".conversation-header").boundingBox();
      await page.locator(".system-sidebar").hover();
      await expect(page.locator(".system-sidebar")).toHaveCSS("width", "232px");
      const after = await page.locator(".conversation-header").boundingBox();
      expect(after?.x).toBe(before?.x);
      await page.keyboard.press("Escape");
      await expect(page.locator(".system-sidebar")).toHaveCSS("width", "64px");
    }
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/setting");
  await expect(
    page.getByRole("heading", { name: "Workspace settings" }),
  ).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
});

test("2000-message fixture keeps only a recent window and records input-to-frame timing", async ({
  page,
}) => {
  await chat(page, "performance");
  await expect(page.locator(".message")).toHaveCount(50);
  await page.evaluate(() => {
    const textarea = document.querySelector("textarea")!;
    const samples: number[] = [];
    (window as unknown as { inputSamples: number[] }).inputSamples = samples;
    textarea.addEventListener("input", () => {
      const start = performance.now();
      requestAnimationFrame(() => samples.push(performance.now() - start));
    });
  });
  await page
    .getByRole("textbox", { name: "Tin nhắn", exact: true })
    .pressSequentially("abcdefghijklmnopqrst", { delay: 20 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const samples = await page.evaluate(
    () => (window as unknown as { inputSamples: number[] }).inputSamples,
  );
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  fs.writeFileSync(
    path.join(artifact, "performance.json"),
    JSON.stringify(
      {
        fixtureMessages: 2000,
        renderedMessages: 50,
        browser: page.context().browser()?.version(),
        viewport: page.viewportSize(),
        os: process.platform,
        measurement:
          "input event to next animation frame; local Chrome, not production INP",
        samples,
        p95ms: p95,
      },
      null,
      2,
    ),
  );
  expect(samples.length).toBeGreaterThanOrEqual(20);
  expect(p95).toBeLessThan(100);
});

test("public unknown URLs and error/empty/loading scenarios are recoverable", async ({
  page,
}) => {
  await page.goto("/unknown-page");
  await expect(
    page.getByRole("heading", { level: 1, name: "Không tìm thấy trang" }),
  ).toBeVisible();
  await login(page);
  await page.goto("/chat?scenario=error");
  await expect(
    page.getByRole("button", { name: "Thử lại", exact: true }),
  ).toBeVisible();
  await page.goto("/chat?scenario=loading");
  await expect(
    page.getByRole("status", { name: "Đang tải…", exact: true }),
  ).toBeVisible();
  await expect(page.locator("textarea")).toBeVisible();
  await page.goto("/chat?scenario=empty");
  await expect(
    page.getByText("Mỗi nghiên cứu bắt đầu từ một câu hỏi."),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Tôi nên kiểm tra chất lượng dữ liệu như thế nào?",
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn", exact: true }),
  ).toHaveValue("Tôi nên kiểm tra chất lượng dữ liệu như thế nào?");
  await expect(page.locator(".message")).toHaveCount(0);
});

test("logout during replay clears overlays and does not leak USER data to ADMIN", async ({
  page,
}) => {
  await chat(page, "demo-replay");
  await page
    .getByRole("textbox", { name: "Tin nhắn", exact: true })
    .fill("Interrupted by logout");
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  await expect(page.locator(".replay-text")).toBeVisible();
  await page.locator(".system-sidebar").hover();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(page).toHaveURL("/login");
  await expect(page.locator(".message,.agent-inspector")).toHaveCount(0);
  await page.getByRole("button", { name: /ADMIN/ }).click();
  await page.getByRole("button", { name: "Vào không gian làm việc" }).click();
  await expect(page).toHaveURL("/admin/users");
  await expect(page.getByText("Interrupted by logout")).toHaveCount(0);
});

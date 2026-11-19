// The seven end-to-end journeys of doc 17 ("End-to-end (Playwright, fake mode)"). They run
// in order against one fresh fake-mode stack: each leaves state the next one uses (alice and
// her agents, the golden task, the builder commits, its folder history, the trace).
import { expect, test, type Page } from "@playwright/test";

const ADMIN = {
  username: process.env.ADMIN_USERNAME ?? "admin",
  password: process.env.ADMIN_PASSWORD ?? "",
};
const ALICE = { username: "alice", password: "E2e-Alice!2026" };
const GOLDEN =
  "Vì sao căn MAS-U03832 bán chậm? So sánh với các căn tương đồng, vẽ biểu đồ và xuất báo cáo.";

test.describe.configure({ mode: "serial" });

async function login(page: Page, username: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#email").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Vào không gian làm việc" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

let builderId = "";

test("1 · the admin creates alice (fabrikam) and provisioning finishes", async ({ page }) => {
  await login(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Tạo người dùng" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#u-name").fill(ALICE.username);
  await dialog.locator("#u-pass").fill(ALICE.password);
  await dialog.locator("#u-domain").selectOption("fabrikam");
  await dialog.locator("#u-display").fill("Alice");
  await dialog.getByRole("button", { name: "Tạo người dùng" }).click();
  const row = page.getByRole("row", { name: /alice/ });
  await expect(row).toContainText("Đang khởi tạo");
  await expect(row).toContainText("Sẵn sàng", { timeout: 480_000 });
});

test("2 · alice asks the golden question and gets the reply with its attachment", async ({ page }) => {
  await login(page, ALICE.username, ALICE.password);
  await expect(page).toHaveURL(/\/chat/);
  const list = page.getByRole("navigation", { name: "Trò chuyện" });
  await expect(list.getByRole("link").first()).toContainText("Điều phối");
  const box = page.getByRole("textbox", { name: "Tin nhắn" });
  // the golden task runs for only a couple of seconds, so sample the banner while it does
  await page.evaluate(() => {
    const w = window as unknown as { __banner?: boolean; __sample?: number };
    w.__banner = false;
    w.__sample = window.setInterval(() => {
      if (document.body.innerText.includes("Việc đang làm:")) w.__banner = true;
    }, 100);
  });
  await box.fill(GOLDEN);
  await box.press("Enter");
  await expect(page.getByText("units.csv").first()).toBeVisible({ timeout: 120_000 });
  expect(await page.evaluate(() => (window as unknown as { __banner?: boolean }).__banner)).toBe(true);
  await expect(page.getByText(/Việc đang làm:/)).toBeHidden();
});

test("3 · the group 'Nhóm báo cáo Q3' changes both agents' statuses", async ({ page }) => {
  await login(page, ALICE.username, ALICE.password);
  await page.getByRole("button", { name: "Nhóm mới" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("Nhóm báo cáo Q3");
  await dialog.getByRole("checkbox", { name: /Data/ }).check();
  await dialog.getByRole("checkbox", { name: /Report/ }).check();
  await dialog.getByRole("button", { name: "Tạo nhóm" }).click();
  await expect(page.getByRole("heading", { name: /Nhóm báo cáo Q3/ })).toBeVisible();

  // watch the app's own SSE channel while sending: both members change status (doc 17 #3)
  await page.evaluate(() => {
    const w = window as unknown as {
      __statuses?: { agent_id: string; status: string }[];
      __es?: EventSource;
    };
    w.__statuses = [];
    const es = new EventSource("/api/stream", { withCredentials: true });
    es.addEventListener("agent.status", (event) =>
      w.__statuses!.push(JSON.parse((event as MessageEvent).data)),
    );
    w.__es = es;
  });
  const box = page.getByRole("textbox", { name: "Tin nhắn" });
  await box.fill("Cập nhật số liệu quý này.");
  await box.press("Enter");
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = window as unknown as { __statuses?: { agent_id: string; status: string }[] };
          return new Set(
            (w.__statuses ?? []).filter((e) => e.status && e.status !== "idle").map((e) => e.agent_id),
          ).size;
        }),
      { timeout: 180_000 },
    )
    .toBeGreaterThanOrEqual(2);
  await page.evaluate(() => (window as unknown as { __es?: EventSource }).__es?.close());
});

test("4 · the builder applies the data preset and installs the xlsx skill", async ({ page }) => {
  await login(page, ALICE.username, ALICE.password);
  await page.goto("/agents");
  await page.locator('a[href$="/info"]', { hasText: "Data" }).first().click();
  await expect(page).toHaveURL(/\/agents\/[^/]+\/info/);
  builderId = new URL(page.url()).pathname.split("/")[2];

  await page.getByRole("link", { name: "Thư viện" }).click();
  await page
    .locator(".builder-card", { hasText: "Phân tích dữ liệu" })
    .getByRole("button", { name: "Áp dụng" })
    .click();
  await expect(page.locator(".builder-toast", { hasText: "Xong:" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("cell", { name: "pandas", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Kỹ năng" }).click();
  await page.locator("button.builder-card", { hasText: "Đọc & tạo file Excel" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cài" }).click();
  await expect(page.locator(".builder-toast", { hasText: "Xong:" }).nth(1)).toBeVisible({ timeout: 120_000 });
  await expect(
    page.locator(".builder-card", { hasText: "Đọc & tạo file Excel" }).getByText("Đã cài"),
  ).toBeVisible();
});

test("5 · the folder viewer redacts .env.d and shows the old pyproject.toml", async ({ page }) => {
  await login(page, ALICE.username, ALICE.password);
  await page.goto(`/agents/${builderId}/folder`);
  await page.getByRole("button", { name: ".env.d" }).click();
  await page.getByRole("button", { name: /warehouse\.env/ }).click();
  await expect(page.locator(".folder-view")).toContainText("WAREHOUSE_DSN=••••");
  await expect(page.locator(".folder-view")).not.toContainText("postgres");

  await page.getByRole("button", { name: "Thư mục gốc" }).click();
  await page.getByRole("button", { name: /pyproject\.toml/ }).click();
  await expect(page.locator(".folder-view")).toContainText("pandas");
  // the oldest version is the creation baseline, from before the preset (doc 17 #5)
  const version = page.getByLabel("Phiên bản");
  await version.selectOption({ index: (await version.locator("option").count()) - 1 });
  await expect(page.getByRole("button", { name: "Xem thay đổi" })).toBeVisible();
  await expect(page.locator(".folder-view")).not.toContainText("pandas");
});

test("6 · the admin opens the traces, the diff and marks a jev decision mislabelled", async ({ page }) => {
  await login(page, ADMIN.username, ADMIN.password);
  await page.goto("/admin");
  await page.locator('a[href*="/admin/trace/"]', { hasText: "lead" }).first().click();
  await expect(page).toHaveURL(/\/admin\/trace\//);
  await expect(page.locator(".trace-code").first()).toBeVisible(); // the Python call
  await expect(page.locator(".trace-output").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Mở trong Langfuse" }).first()).toBeVisible();

  // the data agent's exec wrote files/units.csv, so its call carries the changed files + diff
  await page.locator(".admin-sidebar a", { hasText: "data" }).first().click();
  const call = page.locator(".trace-call", { has: page.locator(".trace-changed") }).first();
  await expect(call.locator(".trace-changed code").first()).toContainText("files/units.csv");
  await call.getByRole("button", { name: "Xem thay đổi" }).click();
  await expect(call.locator("pre.trace-code").nth(1)).toContainText("units.csv");

  await page.locator(".admin-sidebar a", { hasText: "lead" }).first().click();
  await page.getByRole("button", { name: "Gắn nhãn sai" }).first().click();
  await expect(page.getByText(/Đã đánh dấu/).first()).toBeVisible();
});

test("7 · the theme is switched from Settings and kept after a reload", async ({ page }) => {
  // the shell has no header toggle: theme lives in Settings (a user page, so alice, not admin)
  await login(page, ALICE.username, ALICE.password);
  await page.goto("/setting");
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  const [label, expected] = before === "dark" ? ["Sáng", "light"] : ["Tối", "dark"];
  await page.getByRole("radio", { name: label, exact: true }).check();
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", expected);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", expected);
});

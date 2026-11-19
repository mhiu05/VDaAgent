import { test, expect, type Page } from "@playwright/test";

async function signIn(page: Page, role: "USER" | "ADMIN") {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(role) }).click();
  await page.getByRole("button", { name: "Vào không gian làm việc" }).click();
  // Dashboard canonicalizes period filters into the query string.
  await expect(page).toHaveURL(
    (url) => url.pathname === (role === "USER" ? "/" : "/admin/users"),
  );
}

test("foundation login and independent role guard", async ({ page }) => {
  await signIn(page, "USER");
  await expect(page.locator('.system-links a[href="/"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator('.system-links a[href="/chat"]')).toBeVisible();
  await expect(
    page.locator('.system-links a[href="/admin/users"]'),
  ).toHaveCount(0);
  await page.goto("/admin/users");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Bạn không có quyền truy cập trang này",
    }),
  ).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === "/admin/users");
  await expect(page.getByRole("table")).toHaveCount(0);
});

// Requires the real Machine 2 workspace bridge. Deliberately no placeholder
// alternative or skip: run against the integrated workspace for this contract.
test("foundation Dashboard renders fixture-backed KPIs and project data", async ({
  page,
}) => {
  await signIn(page, "USER");
  await page.goto("/?from=2026-09-16&to=2026-10-16&timezone=Asia%2FBangkok");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", {
      level: 1,
      name: "Trang chủ",
      exact: true,
    }),
  ).toBeVisible();
  await expect(main.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    main.getByRole("heading", { name: "Căn còn tồn", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Tỷ lệ tồn từ 180 ngày", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Giao dịch hoàn tất", exact: true }),
  ).toBeVisible();
  // de882645 default fixtures: 120 available, 36/114 aged 180+, 45 completed.
  await expect(main.locator("[data-metric]")).toHaveCount(3);
  await expect(main.locator('[data-metric="inventory"]')).toHaveText("120căn");
  await expect(main.locator('[data-metric="slowShare"]')).toHaveText("31,6%");
  await expect(main.locator('[data-metric="transactions"]')).toHaveText(
    "45giao dịch",
  );
  const projects = main.getByRole("table", {
    name: "Dự án đáng kiểm tra",
    exact: true,
  });
  await expect(projects.getByRole("row")).toHaveCount(4);
  const riverside = projects.getByRole("row", { name: /VDA Demo Riverside/ });
  await expect(
    riverside.getByRole("cell", { name: "20/56", exact: true }),
  ).toBeVisible();
  await expect(
    projects.getByRole("rowheader", { name: /VDA Demo Green Park/ }),
  ).toBeVisible();
  await expect(
    projects.getByRole("rowheader", { name: /VDA Demo Long Garden/ }),
  ).toBeVisible();
  // A working project filter must update the data, not only the page heading.
  await page.getByLabel("Dự án", { exact: true }).selectOption("P-A");
  await expect(main.locator('[data-metric="inventory"]')).toHaveText("60căn");
  await expect(main.locator('[data-metric="slowShare"]')).toHaveText("35,7%");
  await expect(main.locator('[data-metric="transactions"]')).toHaveText(
    "24giao dịch",
  );
  await expect(projects.getByRole("row")).toHaveCount(2);
  await expect(
    projects.getByRole("rowheader", { name: /VDA Demo Green Park/ }),
  ).toHaveCount(0);
});

test("foundation ADMIN cannot access the USER Dashboard", async ({ page }) => {
  await signIn(page, "ADMIN");
  await expect(
    page.locator('.system-links a[href="/admin/users"]'),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator('.system-links a[href="/"]')).toHaveCount(0);
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Bạn không có quyền truy cập trang này",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Trang chủ", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("[data-metric]")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
});

import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, role = "USER") {
  await page.goto("/login");
  await page.getByRole("button", { name: role, exact: false }).click();
  await page.getByRole("button", { name: "Vào không gian làm việc" }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === (role === "USER" ? "/" : "/admin/users"),
  );
}

test("sidebar collapses after pointer navigation and keeps keyboard navigation available", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const sidebar = page.locator(".system-sidebar");
  const logout = sidebar.getByRole("button", { name: "Đăng xuất", exact: true });
  await expect(logout).toBeHidden();
  await sidebar.hover();
  await expect(sidebar).toHaveCSS("width", "232px");
  await expect(logout).toBeVisible();
  await sidebar.locator('a[href="/chat"]').click();
  await page.mouse.move(700, 450);
  await expect(page).toHaveURL("/chat");
  await expect(sidebar).toHaveCSS("width", "64px");
  await expect(logout).toBeHidden();
  await expect(page.locator(".demo-notice")).toHaveCount(0);
  await expect(page.locator(".main-viewport")).toHaveCSS("height", "900px");
  await sidebar.hover();
  await sidebar.locator('a[href="/chat"]').click();
  await page.mouse.move(700, 450);
  await expect(sidebar).toHaveCSS("width", "64px");
  await sidebar.locator('a[href="/"]').focus();
  await page.keyboard.press("Tab");
  await expect(sidebar).toHaveCSS("width", "232px");
  await expect(logout).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveCSS("width", "64px");
});

test("collapsed sidebar centers every navigation icon and the profile avatar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.mouse.move(700, 450);
  const sidebar = page.locator(".system-sidebar");
  await expect(sidebar).toHaveCSS("width", "64px");
  const offsets = await sidebar.evaluate((rail) => {
    const bounds = rail.getBoundingClientRect();
    const center = bounds.x + rail.clientWidth / 2;
    return [
      ...rail.querySelectorAll(
        ".brand-lockup > .brand-mark, .system-links a > svg, .system-profile .avatar",
      ),
    ].map((el) => {
      const box = el.getBoundingClientRect();
      return {
        element: el.tagName,
        width: box.width,
        offset: Math.abs(box.x + box.width / 2 - center),
      };
    });
  });
  for (const icon of offsets) {
    expect(icon.width).toBeGreaterThanOrEqual(20);
    expect(icon.offset).toBeLessThanOrEqual(1);
  }
  await sidebar.hover();
  await expect(sidebar).toHaveCSS("width", "232px");
  await expect(
    sidebar.getByRole("link", { name: "Trang chủ", exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: "Kho báo cáo", exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: "Trợ lý agent", exact: true }),
  ).toBeVisible();
  await expect(sidebar).not.toContainText("FIELDNOTE WORKSPACE");
  await expect(sidebar.locator('a[href="/setting"] > svg')).toHaveClass(
    /lucide-settings/,
  );
  const profile = await sidebar.locator(".system-profile > a").boundingBox();
  const logout = sidebar.getByRole("button", {
    name: "Đăng xuất",
    exact: true,
  });
  const logoutBox = await logout.boundingBox();
  expect(
    Math.abs(
      profile!.y + profile!.height / 2 - logoutBox!.y - logoutBox!.height / 2,
    ),
  ).toBeLessThanOrEqual(1);
  await expect(logout).toHaveText("");
  await expect(sidebar.locator(".rail-toggle")).toHaveCount(0);
});

for (const role of ["USER", "ADMIN"]) {
  test(`${role} sign-out button fits inside the expanded sidebar`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, role);
    const sidebar = page.locator(".system-sidebar");
    await sidebar.hover();
    await expect(sidebar).toHaveCSS("width", "232px");
    const rail = (await sidebar.boundingBox())!;
    const logout = (await sidebar
      .getByRole("button", { name: "Đăng xuất", exact: true })
      .boundingBox())!;
    // toBeVisible() ignores the rail's overflow clipping, so compare the boxes.
    expect(logout.x + logout.width).toBeLessThanOrEqual(rail.x + rail.width);
  });
}

test("selecting Reports releases the hovered rail before a card is opened", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const sidebar = page.locator(".system-sidebar");
  await sidebar.hover();
  await expect(sidebar).toHaveCSS("width", "232px");
  await sidebar.locator('a[href="/reports"]').click({ position: { x: 24, y: 22 } });
  await expect(page.locator(".report-cards")).toBeVisible();
  // Keep the pointer where the navigation click left it. Moving it away hid
  // the overlay bug in the earlier sidebar regression test.
  await expect(sidebar).toHaveCSS("width", "64px");
  await page.locator(".report-cards h2 a").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("changing theme applies and persists immediately without the save button", async ({
  page,
}) => {
  await login(page);
  await page.goto("/setting");
  await page.getByRole("radio", { name: "Tối", exact: true }).check();
  const save = page.getByRole("button", { name: "Lưu thay đổi", exact: true });
  await expect(save).toHaveCount(1);
  await expect(save).toBeDisabled();
  await expect(
    page.locator(".settings-save").getByRole("status"),
  ).toContainText("Tùy chọn đã được lưu");
  await expect(
    page.getByRole("button", { name: "Đã lưu thay đổi", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 500 });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

for (const role of ["USER", "ADMIN"]) {
  test(`mobile ${role} navigation keeps icon logout beside the profile`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await login(page, role);
    await expect(page.locator(".demo-notice")).toHaveCount(0);
    await expect(page.locator(".main-page")).toHaveCSS("min-height", "634px");
    if (role === "USER") {
      await page.goto("/chat");
      await expect(page.locator(".main-viewport")).toHaveCSS("height", "664px");
      await expect(page.locator("textarea")).toBeInViewport();
    }
    const trigger = page.getByRole("button", {
      name: "Điều hướng",
      exact: true,
    });
    await trigger.click();
    const drawer = page.getByRole("dialog", {
      name: "Điều hướng",
      exact: true,
    });
    const profile = drawer.locator(".system-profile");
    const identity = await profile
      .locator(":scope > a, :scope > .profile-identity")
      .boundingBox();
    const logout = profile.getByRole("button", {
      name: "Đăng xuất",
      exact: true,
    });
    const button = await logout.boundingBox();
    expect(
      Math.abs(
        identity!.y + identity!.height / 2 - button!.y - button!.height / 2,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(logout).toHaveText("");
    await expect(logout).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Đăng xuất", exact: true })
      .click();
    await expect(page).toHaveURL("/login");
  });
}

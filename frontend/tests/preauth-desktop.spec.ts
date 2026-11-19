import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function openAuth(page: Page) {
  await page.goto("/login");
  await page.locator(".vda-demo-intro button").click();
  await page.locator(".vda-tour-skip").click();
  await page.locator(".vda-demo-complete").getByRole("button", { name: /Create your own agent/i }).click();
  await expect(page.locator(".sd-auth-card")).toBeVisible();
}

test("auth page shows three areas without exposed credentials or horizontal overflow", async ({ page }) => {
  for (const size of [{ width: 1366, height: 768 }, { width: 1440, height: 900 },
    { width: 1920, height: 1080 }, { width: 820, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await openAuth(page);
    await expect(page.getByRole("heading", { name: "Bắt đầu không gian AI của riêng bạn." }))
      .toBeVisible({ visible: size.width >= 768 });
    await expect(page.locator(".sd-quick-row")).toHaveCount(3);
    await expect(page.locator(".sd-demo-credentials")).toHaveCount(0);
    await expect(page.getByRole("img", { name: "Robot trợ lý AI VDaAgent" }))
      .toBeVisible({ visible: size.width >= 768 });
    const overflow = await page.locator("body").evaluate((element) => element.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    const card = (await page.locator(".sd-auth-card").boundingBox())!;
    const quick = (await page.locator(".sd-quick-access").boundingBox())!;
    if (size.width >= 1024) expect(quick.x).toBeGreaterThan(card.x + card.width);
    if (size.width < 768) expect(quick.y).toBeGreaterThan(card.y + card.height);
  }
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
});

for (const [label, role] of [
  ["Demo quản trị", "admin"],
  ["Demo VRE", "user"],
  ["Demo Alice", "user"],
] as const) {
  test(`${label} enters the expected workspace in one click`, async ({ page }) => {
    await openAuth(page);
    await page.getByRole("button", { name: new RegExp(label, "i") }).click();
    await expect(page).toHaveURL((url) => role === "admin"
      ? url.pathname.startsWith("/admin")
      : url.pathname === "/" || url.pathname.startsWith("/chat/"));
    await expect(page.locator(".system-sidebar")).toBeVisible();
  });
}

test("quick demo disables repeated clicks and shows an inline error", async ({ page }) => {
  await page.goto("/login?scenario=error");
  await page.locator(".vda-demo-intro button").click();
  await page.locator(".vda-tour-skip").click();
  await page.locator(".vda-demo-complete").getByRole("button", { name: /Create your own agent/i }).click();
  const quick = page.getByRole("button", { name: /Demo Alice/i });
  await quick.click();
  await expect(quick).toBeDisabled();
  await expect(page.locator(".sd-quick-error")).toContainText("Không thể đăng nhập tài khoản demo");
});

test("manual validation, password visibility and language switch still work", async ({ page }) => {
  await openAuth(page);
  await page.getByRole("button", { name: "Vào không gian làm việc" }).click();
  await expect(page.getByRole("alert")).toContainText("Vui lòng điền tên đăng nhập");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("example");
  await page.getByRole("button", { name: "Hiện mật khẩu" }).click();
  await expect(page.getByLabel("Mật khẩu", { exact: true })).toHaveAttribute("type", "text");
  await page.locator(".sd-language-trigger").click();
  await page.getByRole("option", { name: /English/i }).click();
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
});

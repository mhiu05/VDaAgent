import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /USER/ }).click();
  await page.getByRole("button", { name: "Vào không gian làm việc" }).click();
  await expect(page).toHaveURL("/");
}

test("notification detail receives focus and returns to its trigger", async ({ page }) => {
  await login(page);
  await page.goto("/notifications");
  const trigger = page.locator(".notification-group li > button").first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const detail = page.locator("#notification-detail");
  await expect(detail).toBeFocused();
  await expect(detail).toBeInViewport();
  await detail.getByRole("button", { name: "Đóng chi tiết" }).click();
  await expect(detail).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.locator(".segmented button").last().click();
  const unread = page.locator(".notification-group li > button").first();
  await unread.click();
  await expect(detail).toBeFocused();
  await detail.getByRole("button", { name: "Đóng chi tiết" }).click();
  await expect(page.locator(".segmented button").first()).toBeFocused();
});

test("chat keeps reading width at medium desktop and uses the inspector dialog", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  await page.goto("/chat");
  await expect(page.locator(".docked-inspector")).toBeHidden();
  const conversation = await page.locator(".conversation-workspace").boundingBox();
  expect(conversation!.width).toBeGreaterThan(900);
  const inspector = page.getByRole("button", { name: "Thông tin Agent", exact: true });
  await inspector.click();
  await expect(page.getByRole("dialog", { name: "Thông tin Agent", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(inspector).toBeFocused();
  await expect(page.locator("textarea")).toBeInViewport();
});

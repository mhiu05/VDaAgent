import { expect, test } from "@playwright/test";

test("guided landing tour completes, replays, and opens the auth gateway", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: /Một câu hỏi/i })).toBeVisible();
  await expect(page.locator(".vda-demo-intro")).toBeVisible();
  await expect(page.getByRole("button", { name: /Trải nghiệm demo/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Đăng nhập \/ Đăng ký/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Vào không gian làm việc/i })).toHaveCount(0);

  await page.locator(".sd-language-trigger").click();
  await expect(page.getByRole("option", { name: /Tiếng Việt/i })).toBeVisible();
  await expect(page.getByRole("option", { name: /English/i })).toBeVisible();
  await page.locator(".sd-language-trigger").click();

  await page.locator(".vda-demo-intro button").click();
  await expect(page.locator(".vda-tour-tooltip")).toContainText("Trò chuyện với 6 agent");
  const firstTransform = await page.locator(".vda-demo-canvas").evaluate((element) => getComputedStyle(element).transform);
  await page.locator(".vda-tour-next").click();
  await page.waitForTimeout(700);
  const secondTransform = await page.locator(".vda-demo-canvas").evaluate((element) => getComputedStyle(element).transform);
  expect(secondTransform).not.toBe(firstTransform);

  for (let step = 1; step < 6; step += 1) {
    await page.locator(".vda-tour-next").click();
    await page.waitForTimeout(180);
  }

  await expect(page.locator(".vda-demo-complete")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create your own agent" })).toBeVisible();

  await page.getByRole("button", { name: /Replay/i }).click();
  await expect(page.locator(".vda-tour-tooltip")).toContainText("Trò chuyện với 6 agent");

  await page.locator(".vda-tour-skip").click();
  await page.locator(".vda-demo-complete").getByRole("button", { name: /Create your own agent/i }).click();
  await expect(page.getByRole("heading", { name: /Bắt đầu không gian AI/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Truy cập nhanh" })).toBeVisible();
  await expect(page.locator(".sd-quick-row")).toHaveCount(3);
  await expect(page.locator(".sd-demo-credentials")).toHaveCount(0);
});

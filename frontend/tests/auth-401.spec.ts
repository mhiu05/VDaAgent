import { expect, test } from "@playwright/test";

test("removes a rejected guest session without retrying the workspace bootstrap", async ({ page }) => {
  let sessionRequests = 0;
  const consoleErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      "p170-guest-session-v1",
      JSON.stringify({ id: "a4e3e2c8-4d8d-4d55-91c3-4d72a0abc123", role: "analyst" }),
    );
  });
  await page.route("**/api/v1/session", async (route) => {
    sessionRequests += 1;
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Rejected test session" }),
    });
  });

  await page.goto("/datasets");

  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page).toHaveTitle(/Profile/);
  await expect(page.locator("#login-title")).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog-overlay]")).toHaveCount(0);
  await expect.poll(() => sessionRequests).toBe(1);
  expect(await page.evaluate(() => window.sessionStorage.getItem("p170-guest-session-v1"))).toBeNull();
  // The intentionally mocked 401 is reported by Chromium as a console error;
  // all other client-side errors would indicate a broken recovery screen.
  expect(consoleErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
  expect((await page.screenshot()).byteLength).toBeGreaterThan(1_000);
});

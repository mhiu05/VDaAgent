import { expect, test } from "@playwright/test";

test("analyst can navigate from dataset list to safe upload workflow", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("http://127.0.0.1:3000", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/chat(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Chat với Data Profiling Agent" })).toBeVisible();
  await page.getByRole("link", { name: "Datasets" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/datasets$/);
  await expect(page.getByRole("heading", { name: "Datasets" })).toBeVisible();
  await page.getByRole("link", { name: "+ Dataset mới" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Upload và bắt đầu profiling" })).toBeVisible();
  await expect(page.getByText("CSV, TSV, Parquet hoặc JSON")).toBeVisible();
  await expect(page.getByLabel("Chế độ scan")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

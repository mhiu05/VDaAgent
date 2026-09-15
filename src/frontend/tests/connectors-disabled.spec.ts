import { expect, test } from "@playwright/test";
import { useAnalystWorkspace } from "./workspace-fixture";

test("browser UI exposes no database connector creation or reuse path", async ({ page }) => {
  await useAnalystWorkspace(page);

  await page.goto("/connectors", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
  await expect(page.getByText("ADD CONNECTOR")).toHaveCount(0);
  await expect(page.getByText("Thiết lập →")).toHaveCount(0);
  await expect(page.getByText("Tải file hoặc nhập dữ liệu từ Google Drive →")).toBeVisible();

  await page.goto("/datasets/new", { waitUntil: "networkidle" });
  await expect(page.getByText("MongoDB Atlas")).toHaveCount(0);
  await expect(page.getByText("MySQL")).toHaveCount(0);
  await expect(page.getByText("DuckDB")).toHaveCount(0);
});

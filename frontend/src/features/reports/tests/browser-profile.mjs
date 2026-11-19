/* global window, URL, document, performance, requestAnimationFrame, setTimeout, clearTimeout */
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import console from "node:console";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);
const baseURL = process.env.WORKSPACE_BASE_URL ?? "http://127.0.0.1:4173";
if (!process.env.CHROME_PATH)
  throw new Error("CHROME_PATH must identify the verification browser.");
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
});
const report = {
  baseURL,
  browser: browser.version(),
  build: "production preview",
  host: {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1),
  },
  conditions:
    "Fresh browser contexts, no extensions, local loopback, no CPU/network throttle. Includes deterministic mock latency. Lab timings do not establish field p75/CWV.",
  samples: [],
  routeChunks: [],
  isolation: {},
  lifecycle: {},
};
const duration = async (operation) => {
  const start = performance.now();
  await operation();
  return +(performance.now() - start).toFixed(2);
};
async function login(page) {
  await page.goto(`${baseURL}/login`);
  await page.getByRole("button", { name: /USER .*@vdaagent.test/ }).click();
  await page
    .getByRole("button", { name: "Vào không gian làm việc", exact: true })
    .click();
  await expect(page.locator('[data-metric="inventory"]')).toContainText("120");
}
async function openReportDashboard(page) {
  await page.locator('.report-cards h2 a[href*="report=R001&"]').click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog').locator('.report-dashboard')).toHaveAttribute('data-version', 'R001-v2');
}
async function expandReport(page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Xem báo cáo đầy đủ', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.report-document')).toContainText('R001-v2');
}
async function closeReport(page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('18 báo cáo', { exact: true })).toBeVisible();
}
try {
  for (const width of [1366, 390])
    for (let run = 1; run <= 3; run++) {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: "reduce",
        colorScheme: "light",
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await login(page);
        const dashboardMs = await duration(async () => {
          await page.goto(`${baseURL}/`);
          await expect(
            page.locator('[data-metric="transactions"]'),
          ).toContainText("45");
        });
        const libraryMs = await duration(async () => {
          await page.goto(`${baseURL}/reports`);
          await expect(
            page.getByText("18 báo cáo", { exact: true }),
          ).toBeVisible();
        });
        const dashboardPopupMs = await duration(() => openReportDashboard(page));
        const readerMs = await duration(() => expandReport(page));
        await page.goto(`${baseURL}/reports?scenario=performance&pageSize=100`);
        await expect(
          page.getByText("10000 báo cáo", { exact: true }),
        ).toBeVisible();
        const cards = page.locator('.report-cards > li');
        await expect(cards).toHaveCount(100);
        const maximumMountedCards = await cards.count();
        expect(maximumMountedCards).toBeLessThanOrEqual(100);
        const search = page.getByRole("searchbox", {
          name: "Tìm báo cáo",
          exact: true,
        });
        await page.evaluate(() => {
          window.__profileInput = [];
          document.addEventListener(
            "input",
            () => {
              const start = performance.now();
              requestAnimationFrame(() =>
                window.__profileInput.push(performance.now() - start),
              );
            },
            { passive: true },
          );
        });
        await search.pressSequentially("9999", { delay: 20 });
        const filterMs = await duration(async () => {
          await search.press("Enter");
          await expect(
            page.getByText("1 báo cáo", { exact: true }),
          ).toBeVisible();
          await expect(cards).toHaveCount(1);
        });
        const inputFrameMs = await page.evaluate(() => window.__profileInput);
        expect(errors).toEqual([]);
        report.samples.push({
          width,
          run,
          dashboardMs,
          libraryMs,
          dashboardPopupMs,
          readerMs,
          filterMs,
          inputFrameMs,
          maximumMountedCards,
        });
        console.info(`PASS profile ${width}px sample ${run}/3`);
      } finally {
        await context.close();
      }
    }
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  const loadedScriptBodies = [];
  const scriptRequests = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") {
      scriptRequests.push(response.url());
      loadedScriptBodies.push(response.text().catch(() => ""));
    }
  });
  await page.addInitScript(() => {
    window.__profileURLs = { created: 0, revoked: 0 };
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      window.__profileURLs.created++;
      return create(blob);
    };
    URL.revokeObjectURL = (url) => {
      window.__profileURLs.revoked++;
      revoke(url);
    };
  });
  await login(page);
  expect(scriptRequests.some((url) => /AdminUsersPage|stress-/.test(url))).toBe(
    false,
  );
  expect(
    (await Promise.all(loadedScriptBodies)).some((body) =>
      body.includes("demo.user."),
    ),
  ).toBe(false);
  report.isolation = {
    userDashboardScriptURLs: [...scriptRequests],
    adminPageLoaded: false,
    adminEmailFixturesLoaded: false,
    stressLoadedByDefault: false,
  };
  const cdp = await context.newCDPSession(page);
  await page.locator('.system-links a[href="/reports"]').click();
  await expect(page.getByText("18 báo cáo", { exact: true })).toBeVisible();
  // Warm both viewer modes, then repeat SPA library/dashboard/detail/download/close lifecycles.
  await openReportDashboard(page);
  await expandReport(page);
  await closeReport(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const before = {
    heap: await cdp.send("Runtime.getHeapUsage"),
    dom: await cdp.send("Memory.getDOMCounters"),
  };
  for (let i = 0; i < 5; i++) {
    await openReportDashboard(page);
    await expandReport(page);
    const waiting = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Tải CSV demo", exact: true })
      .click();
    await waiting;
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__profileURLs.created === window.__profileURLs.revoked,
        ),
      )
      .toBe(true);
    await closeReport(page);
    console.info(`PASS download lifecycle ${i + 1}/5`);
  }
  await cdp.send("HeapProfiler.collectGarbage");
  const after = {
    heap: await cdp.send("Runtime.getHeapUsage"),
    dom: await cdp.send("Memory.getDOMCounters"),
  };
  report.lifecycle = {
    loops: 5,
    before,
    after,
    heapDeltaBytes: after.heap.usedSize - before.heap.usedSize,
    blobURLs: await page.evaluate(() => window.__profileURLs),
    note: "GC snapshots are diagnostic samples, not proof of an absolute absence of leaks.",
  };
  expect(report.lifecycle.blobURLs).toEqual({ created: 5, revoked: 5 });
  await context.close();
  const assets = path.join(root, "frontend/dist/assets");
  for (const name of await fs.readdir(assets))
    if (
      /^(index|DashboardPage|ReportsPage|ReportDetailPage|AdminUsersPage|ChatPage|stress|repository|fixtures)-.*\.js$/.test(
        name,
      )
    ) {
      const bytes = await fs.readFile(path.join(assets, name));
      report.routeChunks.push({
        name,
        bytes: bytes.length,
        gzipBytes: gzipSync(bytes).length,
      });
    }
  report.summary = [1366, 390].map((width) => {
    const samples = report.samples.filter((sample) => sample.width === width);
    return {
      width,
      ...Object.fromEntries(
        ["dashboardMs", "libraryMs", "dashboardPopupMs", "readerMs", "filterMs"].map((key) => {
          const values = samples
            .map((sample) => sample[key])
            .sort((a, b) => a - b);
          return [key, { median: values[1], slowest: values.at(-1) }];
        }),
      ),
    };
  });
  report.status = "PASS";
  console.info(JSON.stringify(report.summary));
} catch (error) {
  report.status = "FAIL";
  report.error = String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  let cleanupTimeout;
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => {
        cleanupTimeout = setTimeout(() => reject(new Error('Verification browser cleanup exceeded 10 seconds.')), 10000);
      }),
    ]);
  } catch (error) {
    report.cleanupError = String(error);
    report.status = 'FAIL';
    process.exitCode = 1;
  } finally {
    clearTimeout(cleanupTimeout);
  }
  await fs.writeFile(
    path.join(
      root,
      "docs/implementation/frontend/workspace-artifacts/production-profile.json",
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
}

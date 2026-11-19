/* global window, document, performance, requestAnimationFrame, PerformanceObserver, localStorage */
import process from "node:process";
import console from "node:console";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { gzipSync } from "node:zlib";
import { chromium, expect } from "@playwright/test";

const stage = process.argv[2] ?? "after";
const baseURL = process.env.WORKSPACE_BASE_URL ?? "http://127.0.0.1:4186";
const output = path.resolve(`../docs/plan/evidence/compact-dashboard/${stage}`);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const report = {
  stage,
  baseURL,
  browser: browser.version(),
  node: process.version,
  host: {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1),
  },
  conditions:
    "Production preview on loopback; headless Chrome; 1366×768; no CPU/network throttle. Three fresh authenticated contexts. rAF gaps are lab samples, not a 60fps guarantee or field CWV.",
  samples: [],
  lifecycle: null,
  bundle: [],
};
try {
  for (let sample = 0; sample < 3; sample++) {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem(
        "vdaagent:v1:demo-user-01:preferences",
        JSON.stringify({
          displayName: "Demo",
          locale: "en",
          theme: "light",
          timezone: "Asia/Bangkok",
          motion: "system",
          density: "comfortable",
          notifications: { reports: true, tasks: true, system: true },
          semanticExplanation: false,
        }),
      );
      const metrics = {
        longTasks: [],
        shifts: [],
        frames: [],
        inputToFrame: [],
        collect: false,
        last: 0,
      };
      Object.assign(window, { __dashboardProfile: metrics });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (metrics.collect) metrics.longTasks.push(e.duration);
      }).observe({ type: "longtask", buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (metrics.collect) metrics.shifts.push(e.value);
      }).observe({ type: "layout-shift", buffered: true });
      const frame = (t) => {
        if (metrics.collect && metrics.last)
          metrics.frames.push(t - metrics.last);
        metrics.last = t;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await page.goto(`${baseURL}/login`);
    await page.getByRole("button", { name: /USER .*@vdaagent.test/ }).click();
    await page.locator("button[type=submit]").click();
    await expect(page.locator('[data-metric="inventory"]')).toHaveText(/120/);
    if (sample === 0 && stage === "after")
      await context.tracing.start({ screenshots: true, snapshots: true });
    const start = performance.now();
    await page.goto(
      `${baseURL}/reports?scenario=report-multiple-charts&report=R001&version=R001-v2&view=dashboard`,
    );
    await expect(
      page.locator(".report-dashboard .schema-chart").first(),
    ).toBeVisible();
    const readyMs = performance.now() - start;
    await page.evaluate(() => {
      const p = window.__dashboardProfile;
      p.collect = true;
      p.last = 0;
      document.addEventListener(
        "change",
        (event) => {
          const select = event.target;
          if (!select?.matches?.(".chart-switcher select")) return;
          const chart =
            select.closest(".analytical-chart") ??
            select.closest(".chart-frame");
          const before = chart
            ?.querySelector("svg.schema-chart")
            ?.getAttribute("aria-label");
          const type = select.value;
          const inputAt = performance.now();
          requestAnimationFrame(() => {
            p.inputToFrame.push({
              type,
              ms: +(performance.now() - inputAt).toFixed(1),
              chartLabelChanged:
                chart
                  ?.querySelector("svg.schema-chart")
                  ?.getAttribute("aria-label") !== before,
            });
          });
        },
        true,
      );
    });
    const select = page.locator(".chart-switcher select").first();
    const switches = [];
    for (const value of ["column", "bar", "column", "bar"]) {
      const start = performance.now();
      await select.selectOption(value);
      await expect(select).toHaveValue(value);
      switches.push(performance.now() - start);
      // Keep this discrete input sample from being superseded before its next frame.
      // Rapid/superseded changes are exercised separately by the browser suite.
      await page.waitForFunction(
        (count) => window.__dashboardProfile.inputToFrame.length >= count,
        switches.length,
      );
    }
    await page.waitForTimeout(600);
    const metrics = await page.evaluate(() => {
      window.__dashboardProfile.collect = false;
      return window.__dashboardProfile;
    });
    const sorted = metrics.frames.sort((a, b) => a - b);
    const percentile = (p) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ??
      null;
    report.samples.push({
      readyMs: +readyMs.toFixed(1),
      switchMs: switches.map((v) => +v.toFixed(1)),
      inputToFrame: metrics.inputToFrame,
      frames: {
        count: sorted.length,
        medianMs: percentile(0.5),
        p95Ms: percentile(0.95),
        maxMs: sorted.at(-1),
        over25ms: sorted.filter((v) => v > 25).length,
      },
      longTasks: metrics.longTasks,
      layoutShiftSum: metrics.shifts.reduce((sum, v) => sum + v, 0),
      svgNodes: await page.locator(".report-dashboard svg *").count(),
    });
    if (sample === 0) {
      const cdp = await context.newCDPSession(page);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await cdp.send("HeapProfiler.collectGarbage");
      const before = {
        dom: await cdp.send("Memory.getDOMCounters"),
        heap: await cdp.send("Runtime.getHeapUsage"),
      };
      const card = page.locator('.report-card h2 a[href*="report=R001&"]');
      const cycles = [];
      for (let cycle = 0; cycle < 5; cycle++) {
        await card.click();
        await expect(page.locator(".report-dashboard")).toBeVisible();
        if (stage === "after") {
          await page
            .locator(".analytical-chart")
            .first()
            .getByRole("button", { name: /^Expand:/ })
            .click();
          await page
            .locator(".report-expanded-slot")
            .getByRole("button", { name: /^Collapse:/ })
            .click();
        }
        await page
          .getByRole("button", { name: "Read full report", exact: true })
          .click();
        await expect(page.locator(".report-document")).toBeVisible();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        if (stage === "after") {
          await cdp.send("HeapProfiler.collectGarbage");
          cycles.push({
            dom: await cdp.send("Memory.getDOMCounters"),
            heap: await cdp.send("Runtime.getHeapUsage"),
          });
        }
      }
      await page.waitForTimeout(600);
      await cdp.send("HeapProfiler.collectGarbage");
      report.lifecycle = {
        cycles: 5,
        cycleDiagnostics: cycles,
        before,
        after: {
          dom: await cdp.send("Memory.getDOMCounters"),
          heap: await cdp.send("Runtime.getHeapUsage"),
        },
        remainingDialogs: await page.getByRole("dialog").count(),
        note: "Diagnostic GC samples; React/router caches and global listeners can warm. Unit/E2E tests separately assert GSAP context teardown and zero detached targets.",
      };
      if (stage === "after")
        await context.tracing.stop({
          path: path.join(output, "motion-trace.zip"),
        });
    }
    await context.close();
  }
  for (const name of (await fs.readdir("dist/assets")).filter((f) =>
    f.endsWith(".js"),
  )) {
    const bytes = await fs.readFile(path.join("dist/assets", name));
    report.bundle.push({
      name,
      bytes: bytes.length,
      gzipBytes: gzipSync(bytes).length,
    });
  }
} finally {
  await fs.writeFile(
    path.join(output, "performance.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
console.log(
  JSON.stringify(
    { stage, samples: report.samples, lifecycle: report.lifecycle },
    null,
    2,
  ),
);

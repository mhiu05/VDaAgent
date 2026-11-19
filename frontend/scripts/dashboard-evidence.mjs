import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
import path from "node:path";

const stage = process.argv[2] ?? "after";
const baseURL = process.env.WORKSPACE_BASE_URL ?? "http://127.0.0.1:5186";
const output = path.resolve(`../docs/plan/evidence/compact-dashboard/${stage}`);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const measurements = [];
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      (theme) =>
        localStorage.setItem(
          "vdaagent:v1:demo-user-01:preferences",
          JSON.stringify({
            displayName: "Demo",
            locale: "en",
            theme,
            timezone: "Asia/Bangkok",
            motion: "reduce",
            density: "comfortable",
            notifications: { reports: true, tasks: true, system: true },
            semanticExplanation: false,
          }),
        ),
      theme,
    );
    await page.goto(`${baseURL}/login`);
    await page.getByRole("button", { name: /USER .*@vdaagent.test/ }).click();
    await page.locator("button[type=submit]").click();
    await page.waitForURL(`${baseURL}/`);
    for (const [name, url, ready] of [
      ["home", "/", ".business-metric"],
      [
        "legacy",
        "/reports?scenario=report-multiple-charts&report=R001&version=R001-v2&view=dashboard",
        ".report-dashboard .chart-frame",
      ],
      [
        "schema",
        "/reports?scenario=report-showcase&report=R019&version=R019-v2&view=dashboard",
        ".report-dashboard .chart-frame",
      ],
    ]) {
      await page.goto(baseURL + url);
      await page.locator(ready).first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      for (const [width, height] of [
        [1440, 900],
        [1366, 768],
        [1024, 768],
        [768, 1024],
        [390, 844],
        [320, 740],
      ]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => {
          window.scrollTo(0, 0);
          const s = document.querySelector(".report-viewer-scroll");
          if (s) s.scrollTop = 0;
        });
        await page.screenshot({
          path: path.join(output, `${name}-${width}-${theme}.png`),
        });
        const data = await page.evaluate(() => {
          const boundary = document
            .querySelector(".report-viewer-scroll")
            ?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
          const bounds = (selector) =>
            [...document.querySelectorAll(selector)].map((e) => {
              const r = e.getBoundingClientRect();
              return {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                complete: r.top >= boundary.top && r.bottom <= boundary.bottom,
                text: e.textContent?.trim().slice(0, 150),
              };
            });
          return {
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            kpis: bounds(".report-kpis > div, .business-metric"),
            charts: bounds(
              ".schema-chart-scroll, .dashboard-charts .chart-frame",
            ),
            findings: bounds(
              ".report-primary-finding, .attention-list details",
            ),
            chartPanels: bounds(".report-dashboard .chart-frame"),
            header: bounds(".report-viewer-header"),
            boundary,
          };
        });
        let accessibility;
        if ([1366, 320].includes(width)) {
          const axe = new AxeBuilder({ page }).withTags([
            "wcag2a",
            "wcag2aa",
            "wcag21a",
            "wcag21aa",
            "wcag22aa",
          ]);
          if (name !== "home") axe.include(".report-viewer");
          const result = await axe.analyze();
          accessibility = {
            violations: result.violations,
            incomplete: result.incomplete.map((i) => ({
              id: i.id,
              nodes: i.nodes.map((n) => ({
                target: n.target,
                summary: n.failureSummary,
              })),
            })),
          };
        }
        measurements.push({
          name,
          theme,
          width,
          height,
          ...data,
          accessibility,
          errors: [...errors],
        });
      }
    }
    await context.close();
  }
} finally {
  await fs.writeFile(
    path.join(output, "measurements.json"),
    JSON.stringify(measurements, null, 2),
  );
  await browser.close();
}
console.log(
  JSON.stringify(
    measurements.map((m) => ({
      name: m.name,
      theme: m.theme,
      width: m.width,
      kpis: m.kpis.filter((b) => b.complete).length,
      charts: m.charts.filter((b) => b.complete).length,
      findings: m.findings.filter((b) => b.complete).length,
      overflow: m.overflow,
      axe: m.accessibility?.violations.map((v) => v.id),
      errors: m.errors,
    })),
    null,
    2,
  ),
);
/* global localStorage, document, window, innerWidth, innerHeight */
import process from "node:process";
import console from "node:console";

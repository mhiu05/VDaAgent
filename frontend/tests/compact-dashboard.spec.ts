import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const legacy =
  "/reports?scenario=report-multiple-charts&report=R001&version=R001-v2&view=dashboard";
const schema =
  "/reports?scenario=report-showcase&report=R019&version=R019-v2&view=dashboard";
async function login(
  page: Page,
  motion: "system" | "reduce" = "system",
  theme: "light" | "dark" = "light",
) {
  await page.addInitScript(
    ({ motion, theme }) => {
      localStorage.setItem(
        "vdaagent:v1:demo-user-01:preferences",
        JSON.stringify({
          displayName: "Demo",
          locale: "en",
          theme,
          timezone: "Asia/Bangkok",
          motion,
          density: "comfortable",
          notifications: { reports: true, tasks: true, system: true },
          semanticExplanation: false,
        }),
      );
    },
    { motion, theme },
  );
  await page.goto("/login");
  await page.getByRole("button", { name: /USER .*@vdaagent.test/ }).click();
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL("/");
}
async function animationStats(page: Page) {
  return page.evaluate(async () => {
    // The actual Vite module instance; no test API or global is added to production.
    const modulePath = "/src/shared/motion/useAnalyticalMotion.ts";
    const { gsap } = await import(modulePath);
    const animations = gsap.globalTimeline.getChildren(true, true, true);
    return {
      active: animations.filter((a: { isActive(): boolean }) => a.isActive())
        .length,
      detached: animations
        .flatMap((a: { targets?: () => unknown[] }) => a.targets?.() ?? [])
        .filter((e: unknown) => e instanceof Element && !e.isConnected).length,
    };
  });
}
async function stable(page: Page) {
  await expect.poll(async () => (await animationStats(page)).active).toBe(0);
}
test.beforeEach(({ page }) => {
  page.on("pageerror", (e) => {
    throw e;
  });
});

test("enabled motion runs, leaves exact data visible and cleans up after rapid type/version changes", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await login(page);
  await page.addInitScript(() => {
    const samples: { id: string | undefined; at: number }[] = [];
    Object.assign(window, { __analyticalMotionSamples: samples });
    new MutationObserver((records) => {
      for (const record of records) {
        const element = record.target as HTMLElement;
        if (element.dataset.animating === "true")
          samples.push({ id: element.dataset.chartId, at: performance.now() });
        if (element.dataset.motion === "kpi" && element.style.transform)
          samples.push({ id: "kpi", at: performance.now() });
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-animating", "style"],
    });
  });
  await page.goto(legacy);
  await expect(page.locator(".report-kpis")).toContainText("60");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __analyticalMotionSamples: unknown[] })
            .__analyticalMotionSamples.length,
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __analyticalMotionSamples: { id?: string }[] }
        ).__analyticalMotionSamples.some((sample) => sample.id === "kpi"),
      ),
    )
    .toBe(true);
  const select = page.locator(".chart-switcher select").first();
  for (const value of ["column", "bar", "column", "bar"])
    await select.selectOption(value);
  for (const value of ["R001-v1", "R001-v2", "R001-v1", "R001-v2"])
    await page.locator("#report-version").selectOption(value);
  await expect(page.locator(".report-dashboard")).toHaveAttribute(
    "data-version",
    "R001-v2",
  );
  await expect(page.locator(".report-kpis")).toContainText("60");
  await expect(page.locator(".report-dashboard .schema-chart")).toHaveCount(2);
  await stable(page);
  expect(await animationStats(page)).toEqual({ active: 0, detached: 0 });
  await info.attach("motion-events", {
    body: JSON.stringify(
      await page.evaluate(
        () =>
          (window as unknown as { __analyticalMotionSamples: unknown[] })
            .__analyticalMotionSamples,
      ),
    ),
    contentType: "application/json",
  });
  await page.goto(schema);
  await expect(page.locator(".report-kpis")).toContainText("72");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __analyticalMotionSamples: { id?: string }[] }
        ).__analyticalMotionSamples.some((sample) => sample.id === "kpi"),
      ),
    )
    .toBe(true);
  await stable(page);
  expect(await animationStats(page)).toEqual({ active: 0, detached: 0 });
});

test("same panel expands with its selection, returns focus/scroll and Escape collapses before closing", async ({
  page,
}) => {
  await login(page);
  await page.goto(legacy);
  const chart = page.locator(".analytical-chart").first();
  await chart.locator("select").selectOption("column");
  await page
    .locator(".report-viewer-scroll")
    .evaluate((e) => (e.scrollTop = 70));
  const before = await page
    .locator(".report-viewer-scroll")
    .evaluate((e) => e.scrollTop);
  const expand = chart.getByRole("button", { name: /^Expand:/ });
  for (let cycle = 0; cycle < 3; cycle++) {
    await expand.click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.locator(".analytical-chart:visible")).toHaveCount(1);
    const expanded = page.locator(".report-expanded-slot .analytical-chart");
    await expect(expanded.locator("select")).toHaveValue("column");
    await expect(
      expanded.getByRole("button", { name: /^Collapse:/ }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(expand).toBeFocused();
    await expect(chart.locator("select")).toHaveValue("column");
    await expect
      .poll(() =>
        page.locator(".report-viewer-scroll").evaluate((e) => e.scrollTop),
      )
      .toBeCloseTo(before, 0);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await stable(page);
  expect((await animationStats(page)).detached).toBe(0);
});

test("keyboard chart values, table, version identity and selected-version export agree", async ({
  page,
}) => {
  await login(page, "reduce");
  await page.goto(schema);
  const panel = page.locator(".analytical-chart").first();
  await panel.getByRole("region").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(panel.locator(".chart-value-feedback")).toContainText("24");
  await panel.locator(".report-chart-table summary").click();
  const cells = await panel.locator("tbody tr").allTextContents();
  await panel.locator("select").selectOption("pie");
  await expect(panel.locator("tbody tr")).toHaveText(cells);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download HTML", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("DEMO-R019-v2.html");
  await page.locator("#report-version").selectOption("R019-v1");
  await expect(page.locator(".report-kpis")).toContainText("60");
  await expect(page.locator(".report-kpis")).toContainText("—");
  await expect(
    page.locator(".analytical-chart").first().locator("select"),
  ).toHaveValue("donut");
});

for (const preference of ["os", "app"] as const)
  test(`reduced motion from ${preference} skips every chart reveal`, async ({
    page,
  }) => {
    await page.emulateMedia({
      reducedMotion: preference === "os" ? "reduce" : "no-preference",
    });
    await login(page, preference === "app" ? "reduce" : "system");
    await page.goto(schema);
    await expect(page.locator(".report-kpis")).toContainText("72");
    await expect(page.locator("[data-animating]")).toHaveCount(0);
    expect(await animationStats(page)).toEqual({ active: 0, detached: 0 });
    await page
      .locator(".analytical-chart")
      .first()
      .getByRole("button", { name: /^Expand:/ })
      .click();
    await expect(
      page.locator(".report-expanded-slot .schema-chart"),
    ).toBeVisible();
    expect(await animationStats(page)).toEqual({ active: 0, detached: 0 });
  });

test("repeated close/open and mode changes release timelines and retain the library trigger", async ({
  page,
}, info) => {
  await login(page);
  await page.goto("/reports?q=R001");
  const trigger = page.locator(".report-card h2 a");
  const cdp = await page.context().newCDPSession(page);
  const listeners: number[] = [];
  for (let cycle = 0; cycle < 5; cycle++) {
    await trigger.click();
    await expect(page.locator(".report-dashboard")).toBeVisible();
    await page
      .getByRole("button", { name: "Read full report", exact: true })
      .click();
    await expect(page.locator(".report-document")).toBeVisible();
    await page
      .getByRole("button", { name: "Back to dashboard", exact: true })
      .click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await animationStats(page)).detached).toBe(0);
    await cdp.send("HeapProfiler.collectGarbage");
    listeners.push((await cdp.send("Memory.getDOMCounters")).jsEventListeners);
  }
  expect(listeners.at(-1)!).toBeLessThanOrEqual(listeners[1]);
  await info.attach("closed-viewer-listener-counts", {
    body: JSON.stringify(listeners),
    contentType: "application/json",
  });
});

test("closing immediately after a view change returns to the originating library", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports?q=R001");
  const trigger = page.locator(".report-card h2 a");
  await trigger.click();
  await expect(page.locator(".report-dashboard")).toBeVisible();
  await page
    .getByRole("button", { name: "Read full report", exact: true })
    .click();
  await expect(page.locator(".report-document")).toBeVisible();
  // Dispatch consecutive user actions before React commits the new route props.
  await page.evaluate(() => {
    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ];
    buttons
      .find((button) => button.textContent === "Back to dashboard")!
      .click();
    buttons
      .find((button) => button.getAttribute("aria-label") === "Close")!
      .click();
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/reports\?q=R001$/);
  await expect(trigger).toBeFocused();
});

for (const theme of ["light", "dark"] as const)
  test(`responsive overview, expanded chart, table and full reader in ${theme}`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    await login(page, "reduce", theme);
    for (const [width, height] of [
      [1440, 900],
      [1366, 768],
      [1024, 768],
      [768, 1024],
      [390, 844],
      [320, 740],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(legacy);
      await expect(page.locator(".report-dashboard")).toBeVisible();
      const overflow = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
      expect(await overflow()).toBe(false);
      if (width >= 1366) {
        const counts = await page.evaluate(() => {
          const region = document
            .querySelector(".report-viewer-scroll")!
            .getBoundingClientRect();
          const complete = (selector: string) =>
            [...document.querySelectorAll(selector)].filter((e) => {
              const b = e.getBoundingClientRect();
              return b.top >= region.top && b.bottom <= region.bottom;
            }).length;
          return {
            kpis: complete(".report-kpis > div"),
            charts: complete(".report-dashboard .schema-chart-scroll"),
            findings: complete(".report-primary-finding"),
          };
        });
        expect(counts).toEqual({ kpis: 4, charts: 2, findings: 1 });
        const font = await page
          .locator(".chart-label")
          .first()
          .evaluate(
            (e) =>
              (parseFloat(getComputedStyle(e).fontSize) *
                e.getBoundingClientRect().height) /
              (e as SVGGraphicsElement).getBBox().height,
          );
        expect(font).toBeGreaterThanOrEqual(11.9);
      }
      await page
        .locator(".analytical-chart")
        .first()
        .getByRole("button", { name: /^Expand:/ })
        .click();
      const expanded = page.locator(".report-expanded-slot");
      await expanded.locator(".report-chart-table summary").click();
      await expect(expanded.getByRole("table")).toBeVisible();
      expect(await overflow()).toBe(false);
      await page.screenshot({
        path: info.outputPath(`expanded-table-${width}-${theme}.png`),
      });
      if (width === 320 || width === 1366) {
        const axe = await new AxeBuilder({ page })
          .include(".report-viewer")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(axe.violations).toEqual([]);
      }
      await expanded.getByRole("button", { name: /^Collapse:/ }).click();
      await page
        .getByRole("button", { name: "Read full report", exact: true })
        .click();
      await expect(page.locator(".report-document")).toBeVisible();
      expect(await overflow()).toBe(false);
      await page.screenshot({
        path: info.outputPath(`reader-${width}-${theme}.png`),
      });
    }
  });

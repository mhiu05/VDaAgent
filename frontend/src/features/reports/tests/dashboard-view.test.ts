import { describe, expect, it } from "vitest";
import {
  createReportFixtures,
  demoClock,
  demoUser,
} from "../../../mocks/reports/fixtures";
import { createSchemaFixtures } from "../../../mocks/reports/schema-fixtures";
import { createReportPresentationFixtures } from "../../../mocks/reports/presentation-fixtures";
import { createReportsRepository } from "../../../mocks/reports/repository";
import { deriveReportDashboardView } from "../model/dashboard-view";
import type { SchemaBlock } from "../model/report-schema";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
const repo = (seed = createReportFixtures()) =>
  createReportsRepository(seed, {
    principal: { ...demoUser, reportIds: [...demoUser.reportIds, "R019"] },
    clock: demoClock,
  });
describe("selected version dashboard projection", () => {
  it("keeps all top-level blocks exactly once, without flattening nested sections or mutating snapshots", async () => {
    const detail = await repo(createSchemaFixtures()).readDetail(
      "R019",
      "R019-v2",
    );
    const source = detail.version!.schema!;
    const nested: SchemaBlock = {
      id: "nested",
      title: "Nested",
      kind: "section",
      evidenceIds: [],
      blocks: [
        {
          id: "segment-kpis",
          title: "Nested KPI",
          kind: "metric-grid",
          evidenceIds: [],
          metrics: [],
        },
      ],
    };
    detail.version!.schema = {
      ...source,
      dashboard: [...source.dashboard, nested],
    };
    const before = JSON.stringify(detail);
    freeze(detail);
    const view = deriveReportDashboardView(detail)!;
    expect(view.reportId).toBe("R019");
    expect(view.versionId).toBe("R019-v2");
    const projected = [
      ...view.schema!.metrics,
      ...view.schema!.charts,
      ...view.schema!.finding,
      ...view.schema!.remaining,
    ];
    expect(new Set(projected).size).toBe(source.dashboard.length + 1);
    expect(projected).toHaveLength(source.dashboard.length + 1);
    expect(
      projected.every((b) => detail.version!.schema!.dashboard.includes(b)),
    ).toBe(true);
    expect(view.schema!.charts).toHaveLength(2);
    expect(view.schema!.remaining).toContain(nested);
    expect(view.schema!.metrics[0]).toBe(source.dashboard[0]);
    expect(JSON.stringify(detail)).toBe(before);
  });
  it("uses an older selected version and preserves nulls even when a newer snapshot exists", async () => {
    const detail = await repo(createSchemaFixtures()).readDetail(
      "R019",
      "R019-v1",
    );
    const view = deriveReportDashboardView(freeze(detail))!;
    expect(view.versionId).toBe("R019-v1");
    const metric = view.schema!.metrics[0];
    expect(
      metric.kind === "metric-grid" && metric.metrics.map((m) => m.value),
    ).toEqual([60, null]);
    expect(detail.summary.latestVersion?.id).toBe("R019-v2");
  });
  it.each([
    "report-no-kpi",
    "report-no-chart",
    "report-multiple-charts",
    "report-partial",
  ] as const)("preserves actual legacy content in %s", async (scenario) => {
    const detail = await repo(
      createReportPresentationFixtures(scenario),
    ).readDetail("R001", "R001-v2");
    const view = deriveReportDashboardView(freeze(detail))!;
    expect(view.schema).toBeNull();
    expect([...view.legacy.charts, ...view.legacy.chartsRemaining]).toEqual(
      view.summary.charts,
    );
    expect([...view.legacy.finding, ...view.legacy.findingsRemaining]).toEqual(
      view.summary.findings,
    );
    if (scenario === "report-no-kpi") expect(view.summary.kpis).toEqual([]);
    if (scenario === "report-partial")
      expect(view.summary.kpis.at(-1)?.value).toBeNull();
  });
  it("rejects a foreign schema and never invents a draft snapshot", async () => {
    expect(
      deriveReportDashboardView(await repo().readDetail("R017")),
    ).toBeNull();
    const detail = await repo(createSchemaFixtures()).readDetail(
      "R019",
      "R019-v1",
    );
    detail.version!.schema!.versionId = "R019-v2";
    expect(() => deriveReportDashboardView(detail)).toThrow(/selected version/);
  });
});

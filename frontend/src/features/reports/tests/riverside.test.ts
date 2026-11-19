import { describe, expect, it } from "vitest";
import fixture from "../../../mocks/reports/data/riverside-r010-v2/report.json";
import markdown from "../../../mocks/reports/data/riverside-r010-v2/report.md?raw";
import {
  mapRiversideReport,
  withRiversideReport,
} from "../../../mocks/reports/riverside-adapter";
import {
  createReportFixtures,
  demoClock,
  demoUser,
} from "../../../mocks/reports/fixtures";
import { createReportsRepository } from "../../../mocks/reports/repository";
import { deriveReportDashboardView } from "../model/dashboard-view";
import { defaultReportQuery } from "../model/query";

describe("Riverside Report Agent fixture integration", () => {
  it("maps the canonical KPIs, all buckets, both snapshots and percentage denominators", () => {
    const schema = mapRiversideReport();
    const metrics = schema.dashboard.find((b) => b.kind === "metric-grid")!;
    expect(metrics.kind).toBe("metric-grid");
    if (metrics.kind !== "metric-grid") throw new Error("Missing metrics");
    expect(metrics.metrics.map((m) => m.value)).toEqual([60, 20, 35.7, 93.3]);
    expect(metrics.metrics.map((m) => m.comparison)).toEqual(
      fixture.kpis.map(
        (k) => `${k.comparison.delta_display} · ${k.comparison.note}`,
      ),
    );
    expect(metrics.metrics[2].definition).toContain("20/56");
    expect(fixture.age_buckets.reduce((sum, b) => sum + b.count, 0)).toBe(60);
    expect(
      fixture.snapshots.current.valid_age +
        fixture.snapshots.current.unknown_age,
    ).toBe(60);
    expect(
      fixture.snapshots.previous.valid_age +
        fixture.snapshots.previous.unknown_age,
    ).toBe(66);
    expect(
      (fixture.snapshots.current.aged_180_plus /
        fixture.snapshots.current.valid_age) *
        100,
    ).toBeCloseTo(35.7, 1);
    expect(
      (fixture.snapshots.previous.aged_180_plus /
        fixture.snapshots.previous.valid_age) *
        100,
    ).toBeCloseTo(28.1, 1);
    const chart = schema.dashboard.find((b) => b.kind === "chart")!;
    if (chart.kind !== "chart") throw new Error("Missing chart");
    expect(chart.chart.type).toBe("bar");
    expect(chart.chart.series[0].values).toEqual([24, 12, 14, 6, 4]);
    expect(JSON.stringify(schema)).not.toMatch(/2026-09-15|2026-09-16/);
  });

  it("retains all eight Markdown business sections and replaces images/tables with native canonical blocks", () => {
    const schema = mapRiversideReport();
    expect(schema.sections.map((s) => s.title)).toEqual(
      [...markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1]),
    );
    expect(schema.sections).toHaveLength(8);
    const serialized = JSON.stringify(schema.sections);
    expect(serialized).not.toMatch(
      /09\.|10\. Nguồn|11\.|!\[|\.png|internal_mock_context/,
    );
    expect(serialized).toContain(
      "Chênh lệch giảm 6 căn khả dụng không đồng nghĩa với 6 căn đã bán",
    );
    expect(serialized).toContain("20/56 = 35,7%");
    const section = schema.sections[3];
    if (section.kind !== "section")
      throw new Error("Missing comparison section");
    const chart = section.blocks.find((b) => b.kind === "chart");
    if (chart?.kind !== "chart") throw new Error("Missing comparison chart");
    expect(chart.chart.series.map((s) => s.values)).toEqual([
      [66, 64, 18],
      [60, 56, 20],
    ]);
    expect(() =>
      mapRiversideReport(fixture, markdown.replace("## 08.", "## 09.")),
    ).toThrow(/eight/);
  });

  it("upgrades one existing record, leaves other reports and pinned history unchanged, and is idempotent", async () => {
    const seed = createReportFixtures();
    seed.versions = seed.versions.filter((v) => v.id !== "R010-v2");
    seed.artifacts = seed.artifacts.filter((a) => a.versionId !== "R010-v2");
    const record = seed.records.find((r) => r.id === "R010")!;
    record.versionIds = record.versionIds.filter((id) => id !== "R010-v2");
    record.agent = "Report";
    const otherRecords = structuredClone(
      seed.records.filter((r) => r.id !== "R010"),
    );
    const old = structuredClone(seed.versions.find((v) => v.id === "R010-v1"));
    const oldArtifacts = structuredClone(
      seed.artifacts.filter((a) => a.versionId === "R010-v1"),
    );
    withRiversideReport(seed);
    withRiversideReport(seed);
    expect(seed.records).toHaveLength(18);
    expect(seed.records.filter((r) => r.id === "R010")).toHaveLength(1);
    expect(seed.versions.filter((v) => v.id === "R010-v2")).toHaveLength(1);
    expect(seed.records.filter((r) => r.id !== "R010")).toEqual(otherRecords);
    expect(seed.versions.find((v) => v.id === "R010-v1")).toEqual(old);
    const repository = createReportsRepository(seed, {
      principal: demoUser,
      clock: demoClock,
    });
    const list = await repository.list({ ...defaultReportQuery(), q: "R010" });
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].latestVersion?.id).toBe("R010-v2");
    const detail = await repository.readDetail("R010");
    expect(detail.version?.id).toBe("R010-v2");
    expect(detail.versions.map((v) => v.id)).toEqual(["R010-v2", "R010-v1"]);
    expect((await repository.readDetail("R010", "R010-v1")).version).toEqual(
      old,
    );
    const view = deriveReportDashboardView(detail)!;
    const projected = [
      ...view.schema!.introduction,
      ...view.schema!.metrics,
      ...view.schema!.charts,
      ...view.schema!.finding,
      ...view.schema!.remaining,
    ];
    expect(projected).toHaveLength(detail.version!.schema!.dashboard.length);
    expect(new Set(projected).size).toBe(projected.length);
    for (const artifact of oldArtifacts)
      expect(
        await repository.resolveDownload("R010", "R010-v1", artifact.id),
      ).toMatchObject(artifact);
    for (const artifact of detail.artifacts) {
      const download = await repository.resolveDownload(
        "R010",
        "R010-v2",
        artifact.id,
      );
      expect(download.content).toContain("R010-v2");
      expect(download.content).not.toContain("R010-v1");
      if (artifact.mediaType === "text/html") {
        expect((download.content as string).match(/<h2>/g)).toHaveLength(8);
        expect(download.content).toContain(
          "<strong>60 căn còn khả dụng</strong>",
        );
        expect(download.content).not.toMatch(
          /source-artifact|trace_id|<script/,
        );
      }
    }
  });
});

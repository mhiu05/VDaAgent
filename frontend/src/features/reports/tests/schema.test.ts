import { describe, expect, it } from "vitest";
import { decodeReportSchema } from "../adapters/decode-schema";
import { decodeReportVersion } from "../adapters/decode-version";
import { parseReportQuery, serializeReportQuery } from "../model/query";
import { createSchemaFixtures } from "../../../mocks/reports/schema-fixtures";
import {
  createReportFixtures,
  demoClock,
  demoUser,
} from "../../../mocks/reports/fixtures";
import { createReportsRepository } from "../../../mocks/reports/repository";
import type { ReportSchema } from "../model/report-schema";

const fixture = (): ReportSchema =>
  structuredClone(
    createSchemaFixtures().versions.find((v) => v.id === "R019-v2")!.schema!,
  );
const expected = {
  reportId: "R019",
  versionId: "R019-v2",
  evidenceIds: ["R019-v2-evidence"],
};
describe("versioned report schema", () => {
  it("accepts a custom type with every supported block through the domain decoder", () => {
    const schema = decodeReportSchema(fixture(), expected);
    expect(schema.reportTypeId).toBe("customer-segmentation");
    expect(schema.dashboard.map((b) => b.kind)).toEqual(
      expect.arrayContaining(["metric-grid", "chart", "finding", "data-table"]),
    );
    expect(schema.sections.some((b) => b.kind === "section")).toBe(true);
    expect(schema.sections.some((b) => b.kind === "evidence")).toBe(true);
    expect(schema.diagnostics).toEqual([]);
  });
  it("reads a chart whose absent optional fields were stored as null", () => {
    // Observed live: the backend wrote a chart's absent optional `dimension.unit` (and would write
    // `type`/`description`) as JSON `null`, the decoder rejected the whole schema, and the viewer
    // showed "Phiên bản schema chưa được hỗ trợ" so the report rendered without its charts. Stored
    // report versions are immutable, so rows already written that way must stay readable.
    const schema = fixture();
    const chart = schema.dashboard.find((b) => b.kind === "chart");
    if (chart?.kind !== "chart") throw new Error("fixture has no chart");
    const raw = chart as unknown as { chart: Record<string, unknown> };
    raw.chart.dimension = { ...(raw.chart.dimension as object), unit: null };
    raw.chart.type = null;
    raw.chart.description = null;
    const decoded = decodeReportSchema(schema, expected);
    const block = decoded.dashboard.find((b) => b.kind === "chart");
    expect(block?.kind).toBe("chart");
    if (block?.kind === "chart") {
      expect(block.chart.dimension.unit).toBeUndefined();
      expect(block.chart.type).toBeUndefined();
      expect(block.chart.description).toBeUndefined();
    }
    expect(decoded.diagnostics).toEqual([]);
  });

  it("accepts unknown report types without changing UI code or losing URL filters", () => {
    const schema = { ...fixture(), reportTypeId: "user-created-research" };
    expect(decodeReportSchema(schema, expected).reportTypeId).toBe(
      "user-created-research",
    );
    const parsed = parseReportQuery(
      new URLSearchParams("type=user-created-research"),
    );
    expect(parsed.warnings).toEqual([]);
    expect(
      parseReportQuery(serializeReportQuery(parsed.query)).query.types,
    ).toEqual(["user-created-research"]);
  });
  it("retains unknown blocks as visible diagnostics and strips untrusted fields", () => {
    const input = {
      ...fixture(),
      dashboard: [
        {
          id: "future",
          title: "Future",
          kind: "interactive-script",
          css: "position:fixed",
          script: "alert(1)",
        },
      ],
    };
    const decoded = decodeReportSchema(input, expected);
    expect(decoded.dashboard[0]).toMatchObject({
      kind: "unsupported",
      originalKind: "interactive-script",
    });
    expect(decoded.dashboard[0]).not.toHaveProperty("script");
    expect(decoded.dashboard[0]).not.toHaveProperty("css");
    expect(decoded.diagnostics).toEqual([
      "Unsupported report block: interactive-script",
    ]);
  });
  it("allows optional metadata and empty sections without inventing metrics", () => {
    const schema = decodeReportSchema(
      {
        schemaVersion: 1,
        ...expected,
        title: "Text-only",
        reportTypeId: "notes",
        dashboard: [],
        sections: [],
      },
      expected,
    );
    expect(schema.dashboard).toEqual([]);
    expect(schema.sections).toEqual([]);
    expect(schema.skill).toBeUndefined();
  });
  it("preserves missing values and creates independent nested collections", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const decoded = decodeReportSchema(input, expected);
    const metric = decoded.dashboard.find((b) => b.kind === "metric-grid");
    expect(
      metric?.kind === "metric-grid" && metric.metrics[1].value,
    ).toBeNull();
    (decoded.dashboard as unknown[]).pop();
    const chart = decoded.dashboard.find((b) => b.kind === "chart");
    if (chart?.kind === "chart")
      (chart.chart.series[0].values as (number | null)[])[0] = 999;
    expect(JSON.stringify(input)).toBe(before);
  });
  const invalid = [
    null,
    {},
    { ...fixture(), schemaVersion: 2 },
    { ...fixture(), versionId: "R019-v1" },
    { ...fixture(), reportId: "R001" },
    { ...fixture(), dashboard: null },
    {
      ...fixture(),
      dashboard: [
        { id: "x", title: "x", kind: "text", markdown: "x", span: "fixed" },
      ],
    },
    {
      ...fixture(),
      dashboard: [
        {
          id: "x",
          title: "x",
          kind: "finding",
          text: "x",
          evidenceIds: ["R019-v1-evidence"],
        },
      ],
    },
    {
      ...fixture(),
      dashboard: [
        {
          id: "x",
          title: "x",
          kind: "metric-grid",
          metrics: [{ id: "m", label: "x", value: NaN, unit: "x" }],
        },
      ],
    },
    {
      ...fixture(),
      dashboard: [
        {
          id: "x",
          title: "x",
          kind: "data-table",
          columns: ["A"],
          rows: [["a", 2]],
          unit: "x",
        },
      ],
    },
    {
      ...fixture(),
      dashboard: [fixture().dashboard[0], fixture().dashboard[0]],
    },
  ];
  it.each(invalid.map((input, i) => ({ input, i })))(
    "rejects malformed payload $i",
    ({ input }) => {
      expect(() => decodeReportSchema(input, expected)).toThrow();
    },
  );
  it("retains legacy documents and diagnoses unsupported schema versions", () => {
    const legacy = createReportFixtures().versions[0];
    expect(
      decodeReportVersion(legacy, { reportId: legacy.reportId }).sections,
    ).toEqual(legacy.sections);
    const future = decodeReportVersion(
      { ...legacy, schema: { schemaVersion: 99 } },
      { reportId: legacy.reportId },
    );
    expect(future.schema).toBeUndefined();
    expect(future.schemaIssue).toMatch(/Unsupported/);
    expect(future.sections).toEqual(legacy.sections);
  });
  it("keeps selected custom versions, evidence and downloads isolated and immutable", async () => {
    const data = createSchemaFixtures();
    const repo = createReportsRepository(data, {
      principal: { ...demoUser, reportIds: [...demoUser.reportIds, "R019"] },
      clock: demoClock,
    });
    const before = JSON.stringify(data);
    for (const sequence of [1, 2]) {
      const id = `R019-v${sequence}`;
      const detail = await repo.readDetail("R019", id);
      expect(detail.version?.schema?.versionId).toBe(id);
      expect(detail.evidence.map((e) => e.id)).toEqual([`${id}-evidence`]);
      const artifact = await repo.resolveDownload("R019", id, `${id}-html`);
      expect(artifact.content).toContain(id);
      expect(artifact.content).toContain(sequence === 1 ? "60" : "72");
      expect(artifact.content).not.toContain(
        sequence === 1 ? "R019-v2" : "R019-v1",
      );
      await expect(
        repo.resolveDownload(
          "R019",
          id,
          sequence === 1 ? "R019-v2-html" : "R019-v1-html",
        ),
      ).rejects.toMatchObject({ code: "notFound" });
    }
    expect(JSON.stringify(data)).toBe(before);
  });
  it("generates deterministic fixtures without altering the original reports", () => {
    expect(createSchemaFixtures()).toEqual(createSchemaFixtures());
    const original = createReportFixtures();
    const showcase = createSchemaFixtures();
    for (const v of original.versions)
      expect(showcase.versions.find((s) => s.id === v.id)?.sections).toEqual(
        v.sections,
      );
    expect(original.records).toHaveLength(18);
  });
});

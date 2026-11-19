import { RepositoryError } from "../model/types";
import type { ReportSchema, SchemaBlock } from "../model/report-schema";
import type { ChartSpec } from "../../../shared/charts/chart-contract";
import { validateRange } from "../model/query";

const fail = (): never => {
  throw new RepositoryError("validation", "Invalid report schema");
};
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : fail();
}
function str(v: unknown): string {
  return typeof v === "string" && v.trim() ? v : fail();
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : fail();
}
function num(v: unknown): number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v))
    ? v
    : fail();
}
function strings(v: unknown): string[] {
  return arr(v).map(str);
}
/** Absent optional field. JSON has no `undefined`, and the backend has historically written an
 * absent optional as `null` (a chart's `dimension.unit`, `type`, `description`), so treat `null`
 * as absent too. Stored report versions are immutable, so rows written that way stay readable. */
const optional = (v: unknown) => (v === undefined || v === null ? undefined : str(v));
function chart(v: unknown): ChartSpec {
  const c = obj(v);
  const d = obj(c.dimension);
  if (!["categorical", "temporal", "numeric"].includes(String(d.kind))) fail();
  const labels = arr(c.labels).map((v) =>
    typeof v === "string" ? v : (num(v) ?? fail()),
  );
  const series = arr(c.series).map((v) => {
    const s = obj(v);
    return {
      id: str(s.id),
      label: str(s.label),
      unit: str(s.unit),
      values: arr(s.values).map(num),
    };
  });
  if (
    c.semantic !== undefined &&
    ![
      "comparison",
      "trend",
      "composition",
      "relationship",
      "matrix",
      "distribution",
    ].includes(String(c.semantic))
  )
    fail();
  return {
    id: str(c.id),
    type: optional(c.type),
    title: str(c.title),
    description: optional(c.description),
    dimension: {
      label: str(d.label),
      kind: d.kind as ChartSpec["dimension"]["kind"],
      unit: optional(d.unit),
    },
    labels,
    series,
    semantic: c.semantic as ChartSpec["semantic"],
    sourceId: str(c.sourceId),
    evidenceIds: c.evidenceIds === undefined ? [] : strings(c.evidenceIds),
    ...(c.binEnds === undefined
      ? {}
      : { binEnds: arr(c.binEnds).map((v) => num(v) ?? fail()) }),
  };
}
/** Strict domain decoder. Unknown blocks are retained as bounded, visible diagnostics. */
export function decodeReportSchema(
  value: unknown,
  expected: {
    reportId: string;
    versionId: string;
    evidenceIds: readonly string[];
    reportTypeId?: string;
  },
): ReportSchema {
  const s = obj(value);
  if (s.schemaVersion !== 1)
    throw new RepositoryError(
      "validation",
      "Unsupported report schema version",
    );
  if (
    s.reportId !== expected.reportId ||
    s.versionId !== expected.versionId ||
    (expected.reportTypeId && s.reportTypeId !== expected.reportTypeId)
  )
    throw new RepositoryError("validation", "Report schema identity mismatch");
  const diagnostics: string[] = [];
  const language = optional(s.language);
  if (language && !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) fail();
  function refs(v: unknown): string[] {
    const ids = v === undefined ? [] : strings(v);
    if (ids.some((id) => !expected.evidenceIds.includes(id))) fail();
    return ids;
  }
  function blocks(v: unknown, depth = 0): SchemaBlock[] {
    if (depth > 8) fail();
    const ids = new Set<string>();
    return arr(v).map((value) => {
      const b = obj(value);
      const id = str(b.id);
      const kind = str(b.kind);
      if (ids.has(id)) fail();
      ids.add(id);
      if (b.span !== undefined && b.span !== "full" && b.span !== "half")
        fail();
      const base = {
        id,
        title: str(b.title),
        description: optional(b.description),
        evidenceIds: refs(b.evidenceIds),
        span: b.span as "full" | "half" | undefined,
      };
      if (kind === "section")
        return { ...base, kind, blocks: blocks(b.blocks, depth + 1) };
      if (kind === "text") return { ...base, kind, markdown: str(b.markdown) };
      if (kind === "finding" || kind === "recommendation")
        return { ...base, kind, text: str(b.text) };
      if (kind === "evidence")
        return { ...base, kind, references: refs(b.references) };
      if (kind === "chart") {
        const spec = chart(b.chart);
        refs(spec.evidenceIds);
        return { ...base, kind, chart: spec };
      }
      if (kind === "metric-grid") {
        const metrics = arr(b.metrics).map((v) => {
          const m = obj(v);
          return {
            id: str(m.id),
            label: str(m.label),
            value: num(m.value),
            unit: str(m.unit),
            definition: optional(m.definition),
            comparison: optional(m.comparison),
          };
        });
        if (new Set(metrics.map((m) => m.id)).size !== metrics.length) fail();
        return { ...base, kind, metrics };
      }
      if (kind === "data-table" || kind === "comparison") {
        const columns = strings(b.columns);
        const rows = arr(b.rows).map((v) =>
          arr(v).map((c) => (typeof c === "string" ? c : num(c))),
        );
        if (!columns.length || rows.some((r) => r.length !== columns.length))
          fail();
        return { ...base, kind, columns, rows, unit: str(b.unit) };
      }
      const message = `Unsupported report block: ${kind}`;
      diagnostics.push(message);
      return { ...base, kind: "unsupported", originalKind: kind, message };
    });
  }
  let scope: ReportSchema["scope"];
  if (s.scope !== undefined) {
    const p = obj(s.scope);
    const from = str(p.from);
    const to = str(p.to);
    const timezone = str(p.timezone);
    validateRange(from, to, timezone);
    scope = {
      from,
      to,
      timezone,
      project: optional(p.project),
      market: optional(p.market),
    };
  }
  let skill: ReportSchema["skill"];
  if (s.skill !== undefined) {
    const p = obj(s.skill);
    skill = { id: str(p.id), name: str(p.name), revision: str(p.revision) };
  }
  const dashboard = blocks(s.dashboard);
  const sections = blocks(s.sections);
  return {
    schemaVersion: 1,
    reportId: expected.reportId,
    versionId: expected.versionId,
    reportTypeId: str(s.reportTypeId),
    title: str(s.title),
    description: optional(s.description),
    language,
    domain: optional(s.domain),
    summary: optional(s.summary),
    scope,
    skill,
    limitations: s.limitations === undefined ? [] : strings(s.limitations),
    dashboard,
    sections,
    diagnostics,
  };
}

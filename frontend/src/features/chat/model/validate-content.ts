const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const number = (v: unknown) =>
  v === null || (typeof v === "number" && Number.isFinite(v));
const reference = (v: unknown) =>
  object(v) &&
  typeof v.reportId === "string" &&
  !!v.reportId &&
  typeof v.versionId === "string" &&
  !!v.versionId;
export const validReportReference = reference;

/** Validate persisted public presentation before mounting recursive renderers. */
export function validContentBlocks(value: unknown, depth = 0): boolean {
  if (depth > 8 || !Array.isArray(value)) return false;
  return value.every((b) => {
    if (!object(b) || typeof b.id !== "string") return false;
    switch (b.kind) {
      case "report-ref":
        return reference(b.reference);
      case "action":
        return (
          typeof b.label === "string" &&
          ["report", "group"].includes(String(b.action))
        );
      case "details":
      case "section":
        return (
          typeof b.title === "string" && validContentBlocks(b.blocks, depth + 1)
        );
      case "text":
        return typeof b.markdown === "string";
      case "finding":
      case "recommendation":
        return (
          typeof b.title === "string" &&
          typeof b.text === "string" &&
          (b.description === undefined || typeof b.description === "string")
        );
      case "metric-grid":
        return (
          Array.isArray(b.metrics) &&
          b.metrics.every(
            (m) =>
              object(m) &&
              typeof m.id === "string" &&
              typeof m.label === "string" &&
              number(m.value) &&
              typeof m.unit === "string" &&
              [m.definition, m.comparison].every(
                (v) => v === undefined || typeof v === "string",
              ),
          )
        );
      case "comparison":
      case "data-table":
        return (
          typeof b.title === "string" &&
          typeof b.unit === "string" &&
          strings(b.columns) &&
          Array.isArray(b.rows) &&
          b.rows.every(
            (row) =>
              Array.isArray(row) &&
              row.length === (b.columns as string[]).length &&
              row.every((cell) => typeof cell === "string" || number(cell)),
          )
        );
      case "chart": {
        const c = b.chart;
        return (
          object(c) &&
          typeof c.id === "string" &&
          typeof c.title === "string" &&
          typeof c.sourceId === "string" &&
          object(c.dimension) &&
          typeof c.dimension.label === "string" &&
          ["categorical", "temporal", "numeric"].includes(
            String(c.dimension.kind),
          ) &&
          Array.isArray(c.labels) &&
          c.labels.every(
            (v) =>
              typeof v === "string" ||
              (typeof v === "number" && Number.isFinite(v)),
          ) &&
          Array.isArray(c.series) &&
          c.series.every(
            (s) =>
              object(s) &&
              typeof s.id === "string" &&
              typeof s.label === "string" &&
              typeof s.unit === "string" &&
              Array.isArray(s.values) &&
              s.values.length === (c.labels as unknown[]).length &&
              s.values.every(number),
          )
        );
      }
      case "evidence":
        return typeof b.title === "string" && strings(b.references);
      case "unsupported":
        return (
          typeof b.originalKind === "string" && typeof b.message === "string"
        );
      default:
        return false;
    }
  });
}

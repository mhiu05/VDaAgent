import type {
  ReportSchema,
  SchemaBlock,
} from "../../features/reports/model/report-schema";

const escape = (value: unknown) =>
  String(value ?? "—").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** Safe HTML export for the saved business blocks; never executes authored HTML. */
export function renderSchemaArtifact(
  schema: ReportSchema,
  cutoff: string,
): string {
  const inline = (value: string) =>
    escape(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  function markdown(value: string): string {
    return value
      .split(/\n\s*\n/)
      .map((paragraph) => {
        if (/^#{1,6} /.test(paragraph))
          return `<h3>${inline(paragraph.replace(/^#{1,6} /, ""))}</h3>`;
        if (paragraph.startsWith("- "))
          return `<ul>${paragraph
            .split("\n")
            .map((line) => `<li>${inline(line.replace(/^- /, ""))}</li>`)
            .join("")}</ul>`;
        return `<p>${inline(paragraph).replace(/\n/g, "<br>")}</p>`;
      })
      .join("");
  }
  function table(
    columns: readonly string[],
    rows: readonly (readonly unknown[])[],
  ): string {
    return `<div class="table"><table><thead><tr>${columns.map((c) => `<th scope="col">${escape(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, index) => (index === 0 ? `<th scope="row">${escape(cell)}</th>` : `<td>${escape(cell)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function render(
    blocks: readonly SchemaBlock[],
    parentTitle?: string,
  ): string {
    return blocks
      .map((b) => {
        const heading =
          b.title === parentTitle
            ? ""
            : `<h${parentTitle ? 3 : 2}>${escape(b.title)}</h${parentTitle ? 3 : 2}>`;
        let body = "";
        if (b.kind === "section") body = render(b.blocks, b.title);
        else if (b.kind === "text") body = markdown(b.markdown);
        else if (b.kind === "chart")
          body = table(
            [
              b.chart.dimension.label,
              ...b.chart.series.map((s) => `${s.label} (${s.unit})`),
            ],
            b.chart.labels.map((label, index) => [
              label,
              ...b.chart.series.map((s) => s.values[index]),
            ]),
          );
        else if (b.kind === "data-table" || b.kind === "comparison")
          body = table(b.columns, b.rows);
        else if (b.kind === "metric-grid")
          body = table(
            ["Chỉ số", "Giá trị", "Đơn vị", "Biến động"],
            b.metrics.map((m) => [
              m.label,
              m.value,
              m.unit,
              m.comparison ?? "",
            ]),
          );
        else if (b.kind === "finding" || b.kind === "recommendation")
          body = `<p>${escape(b.text)}</p>`;
        return `<section id="${escape(b.id)}">${heading}${b.description ? `<p>${escape(b.description)}</p>` : ""}${body}</section>`;
      })
      .join("");
  }
  return `<!doctype html><html lang="${escape(schema.language ?? "vi")}"><head><meta charset="utf-8"><meta name="generator" content="VDaAgent DEMO"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(schema.title)} · ${escape(schema.versionId)}</title><style>body{font:16px/1.8 system-ui,sans-serif;color:#192e29;max-width:960px;margin:40px auto;padding:0 24px}h1,h2,h3{line-height:1.4}section{margin:24px 0}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #dfe7e1;padding:10px;text-align:left}thead{background:#edf4ef}.table{overflow:auto}nav a{display:block}h2{border-top:1px solid #dfe7e1;padding-top:24px}@media print{nav{display:none}}</style></head><body><h1>${escape(schema.title)}</h1><p>${escape(schema.versionId)} · ${escape(cutoff)} · Đơn vị lập dự kiến: Report Agent · Dữ liệu mô phỏng</p><nav aria-label="Mục lục">${schema.sections.map((b) => `<a href="#${escape(b.id)}">${escape(b.title)}</a>`).join("")}</nav>${render(schema.sections)}</body></html>`;
}

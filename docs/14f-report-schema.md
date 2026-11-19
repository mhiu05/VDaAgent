# 14f · Report schema and shared charts

**Depends on:** [14](14-frontend.md), [14e](14e-report-viewer.md), [19](19-reports-dashboard-notifications.md)

**Status:** Implemented (mock)

> In the target, agents publish schema v1 payloads via `contoso.publish_report` (see [19](19-reports-dashboard-notifications.md)) and `api` validates them with the same rules before storing. The FE decoder stays the last line of defence.

The source model is [`report-schema.ts`](../frontend/src/features/reports/model/report-schema.ts), [`types.ts`](../frontend/src/features/reports/model/types.ts) and [`chart-contract.ts`](../frontend/src/shared/charts/chart-contract.ts). The schema is the frontend domain contract for one stored report version; it is not the backend wire schema or the chat narrative JSON.

## Two stored content forms

`ReportVersion` always has identity, sequence, source, completion time, policy/content revision, legacy `sections`, evidence IDs and artifact IDs. It may also have `schema: ReportSchema` or `schemaIssue`.

Legacy uses `ReportBlock`: text/methodology/limitations, finding/recommendation, metric-table/comparison and single-series charts. Schema v1 supports extended blocks, multiple series and report-type metadata; the viewer still reads legacy.

| Schema v1 field | Meaning |
| --- | --- |
| `schemaVersion` | Literal `1`. |
| `reportId`, `versionId` | Must match the version being read. |
| `reportTypeId` | Extensible business ID; does not select a per-type component. |
| `title` | Document title. |
| `language`, `description`, `domain`, `skill`, `scope`, `summary` | Optional metadata; skill has ID/name/revision, scope holds dates and timezone. |
| `limitations` | Data/analysis limitations. |
| `dashboard` | Blocks of the report overview; may be empty. |
| `sections` | Document blocks in stored order; may be empty. |
| `diagnostics` | Diagnostics produced by the decoder for unsupported blocks. |

## Block contract

Each `SchemaBlock` has `id`, `title`, `evidenceIds`; it may have `description` and `span: 'full' | 'half'`.

| Kind | Payload |
| --- | --- |
| `metric-grid` | `metrics`: ID, label, `value: number | null`, unit, optional definition/comparison. |
| `chart` | `chart: ChartSpec`. |
| `data-table`, `comparison` | Columns, rows and unit; cells are string, finite number or null. |
| `text` | `markdown`. |
| `finding`, `recommendation` | `text`. |
| `evidence` | `references` pointing to known evidence. |
| `section` | Nested `blocks`. |
| `unsupported` | Fallback result with originalKind and message. |

`ReportBlocks` renders the same contract in the overview and the reader; the compact overview only projects layout as described in [14e](14e-report-viewer.md). It never reorders stored `sections`.

## Decoder and fallback

[`decodeReportVersion`](../frontend/src/features/reports/adapters/decode-version.ts) accepts a mapped domain payload. It checks report/version identity, positive integer sequence, timestamps, numbers/null, legacy block shape, evidence references and source chronology. Unknown legacy blocks are rejected with `RepositoryError('validation')`.

[`decodeReportSchema`](../frontend/src/features/reports/adapters/decode-schema.ts) checks schema v1 and the expected identity, evidence belonging to the stored version, unique metric IDs within a grid, unique block IDs within each collection, complete table columns, valid span and section depth. The decoder rejects depth parameters greater than eight; it never fills in missing numbers. Scope metadata is checked as a date range `[from, to)` and an IANA timezone.

Schema blocks of unknown kind become `unsupported`, get a diagnostic and lose fields outside the contract. No arbitrary script/CSS from the payload runs. Unknown chart types keep their spec so the renderer can show a table.

Calling `decodeReportSchema` directly with a schema version other than 1 fails. Through `decodeReportVersion`, an unsupported schema version is recorded as `schemaIssue`; valid legacy sections remain for the viewer. Without legacy content the UI does not generate a substitute document.

Schema structure checks and chart compatibility checks are separate steps: a ChartSpec can pass the decoder yet not be drawable. The renderer then uses a data-preserving fallback.

## ChartSpec and registry

`ChartSpec` has ID/title, dimension (`categorical`, `temporal`, `numeric`), labels, one or more series, a unit per series, and optional sourceId and evidenceIds. `semantic` may be comparison, trend, composition, relationship, matrix or distribution. `type` may be omitted for the registry to recommend one; an explicitly declared but unsupported type falls back.

[`chart-registry.ts`](../frontend/src/shared/charts/chart-registry.ts) decides drawability and type-switch options:

| Group | Main rule |
| --- | --- |
| `bar`, `column`, `line`, `area` | One series with non-numeric dimension, except the dedicated matrix/distribution cases. |
| `grouped-bar`, `line`, `area` | Multiple series with the same unit, except dedicated semantics. |
| `stacked-bar` | Multiple series, composition semantic and finite cumulative totals. |
| `pie`, `donut` | Single-series composition, at most 12 labels, no null/negative values, finite total greater than 0. |
| `scatter` | Numeric dimension, except matrix/distribution semantics. |
| `heatmap` | Matrix semantic. |
| `histogram` | Single numeric series distribution with `binEnds` matching labels, increasing non-overlapping bins, non-negative or null frequencies. |

Every group must pass common checks: labels/series have data, value lengths match labels, values are finite/null, series IDs and labels are unique, dimension is valid. Series with different units do not share a plot. All-null data produces no chart. `labels.length * series.length > 2000` switches to a table instead of building an oversized SVG; this is a current guard, not a measured performance commitment.

`recommendChart` prefers histogram, heatmap, scatter, line for temporal, donut for composition, grouped-bar for multiple series and bar otherwise; it picks a type only if compatible. Temporal data is copied and sorted by time together with series values. Nulls keep their gaps and are never joined or turned into 0.

The renderer is in-house SVG with three families (cartesian/radial/matrix) and the existing CSS tokens. There is no other chart-engine dependency in the current package. The equivalent data table, local scroll, pagination and chart expansion help read data when it cannot be drawn or the plot is too cramped.

## Minimal schema example

This is a schema payload to pass to the decoder with the matching expected identity; it is not a full `ReportVersion`:

```json
{
  "schemaVersion": 1,
  "reportId": "R100",
  "versionId": "R100-v1",
  "reportTypeId": "customer-segmentation",
  "title": "Phân nhóm khách hàng",
  "language": "vi-VN",
  "limitations": ["Dữ liệu minh họa"],
  "dashboard": [
    {
      "id": "customer-count",
      "kind": "metric-grid",
      "title": "Quy mô mẫu",
      "evidenceIds": [],
      "metrics": [
        { "id": "customers", "label": "Khách hàng", "value": 120, "unit": "người" }
      ]
    }
  ],
  "sections": [
    {
      "id": "method",
      "kind": "text",
      "title": "Phương pháp",
      "evidenceIds": [],
      "markdown": "Mô tả phạm vi và cách phân nhóm từ dữ liệu đã lưu."
    }
  ]
}
```

`diagnostics` in the result is supplied by the decoder. To open it in the app you also need a complete record/version in the reports source, catalog metadata, read permission and artifacts if any; putting schema JSON into the UI alone does not create a report.

## Adding a report type or chart

A new report type that uses existing blocks needs only metadata in `WorkspaceCatalog.reportTypes`, a mapped/validated payload and a stored version with correct identity. The `type` query accepts IDs matching `^[a-z][a-z0-9-]{0,79}$`. No per-type conditions are needed in `ReportDashboard`/`ReportDocument`.

A new block requires deliberately extending the union, the decoder and the renderer/fallback. A new chart requires extending `ChartType`, the registry, compatibility checks, geometry/render family and labels in both locales; add fixtures and tests for nulls, invalid numbers, geometry, the substitute table and browser behaviour. Data the current contract cannot represent must be modelled before it is drawn.

## Fixtures and tests

`report-showcase` provides examples of inventory, sales, benchmarking and custom types; R019-v2 shows customer-segmentation. The mock scenarios `report-unknown-chart`, `report-invalid-chart`, `report-unknown-schema`, `report-unknown-type`, `report-empty-schema` and `report-large-table` exercise fallbacks; the large table has 1,200 rows.

```text
/reports?scenario=report-showcase&report=R019&version=R019-v2
```

These scenarios are chosen when services start; reload after changing the `scenario` query. The default Riverside fixture uses R010-v2 and the same schema source for chat and reports. The full scenario list is in [14g](14g-frontend-development.md).

Main tests: [`schema.test.ts`](../frontend/src/features/reports/tests/schema.test.ts), [`chart-registry.test.ts`](../frontend/src/shared/charts/chart-registry.test.ts), [`ChartRenderer.test.tsx`](../frontend/src/shared/charts/ChartRenderer.test.tsx), [`report-schema.spec.ts`](../frontend/tests/report-schema.spec.ts) and [`riverside.test.ts`](../frontend/src/features/reports/tests/riverside.test.ts).

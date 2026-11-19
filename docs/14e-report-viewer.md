# 14e · Reports library and viewer

**Depends on:** [14](14-frontend.md), [14c](14c-frontend-adapters.md), [14f](14f-report-schema.md), [19](19-reports-dashboard-notifications.md)

**Status:** Implemented (mock)

> Target backend: reports are published by agents and served by `api`; see [19 § Reports library](19-reports-dashboard-notifications.md#reports-library) and [15 § Workspace extensions](15-api.md#workspace-extensions). Target downloads add binary DOCX/PDF/XLSX; the current mock serves HTML/CSV text only. See [current implementation vs target](14-frontend.md#current-implementation-vs-target).

[`ReportsPage`](../frontend/src/features/reports/pages/ReportsPage.tsx) keeps the library in the background and lazy-loads [`ReportDetailPage`](../frontend/src/features/reports/pages/ReportDetailPage.tsx), whose default component is `ReportViewer`. One Radix dialog switches between the `dashboard` and `detail` modes on the same stored version.

The `dashboard` mode is the **report overview** of one report version. The business dashboard at `/` reads its own port and scope; neither screen substitutes the other's data source.

## URL, history and focus

| URL | Default behaviour |
| --- | --- |
| `/reports` | Card list with search, filters, sort and pagination. |
| `/reports?report=R010&version=R010-v2` | Report overview of R010-v2. |
| `/reports?report=R010&version=R010-v2&view=detail` | Full document of the same version. |
| `/reports?report=R010` | Reads the available version, then replaces the URL with the resolved version. |
| `/reports/R010?version=R010-v2` | Compatible deep link; opens the document by default. |

`view=dashboard`/`view=detail` selects the mode. Data identity comes from the URL, never from `location.state`. List queries, repeated filters, timezone, scenario and pagination are kept when switching view/version.

Opening a card, switching mode and switching version create history entries so Back/Forward restore the selection. When opened from a mounted library, `reportViewerDepth` lets Close/Escape return to the original entry in one step. For a direct deep link, closing replaces the URL with the library URL. If opened from chat with a valid chat origin, closing returns to chat; the origin accepts only the internal path `/chat`.

Cards have real target links and support modifier keys/new tabs. Closing returns focus to the trigger if still in the DOM; the library fallback is the results heading. TOC and evidence anchors scroll/focus inside the reader without creating hash entries. Overview and detail keep separate scroll offsets for the life of the mounted viewer.

The dialog provides a focus trap, background scroll lock, title/description and Escape. On mobile the viewer fills almost the whole viewport; heading/actions are separate from the scrolling content.

## Selected version data

`ReportsService.detail(principal, reportId, versionId?, signal?)` returns `ReportDetail`: the summary record, the selected version, the list of versions the principal may view, evidence and artifact metadata.

`useServiceRead` keys on principal/report/version identity and cancels and discards stale results when the selection changes. When no version is pinned, header controls wait for URL normalisation and the canonical read to finish. Switching versions never shows the old document under the new identity.

[`deriveReportVersionSummary`](../frontend/src/features/reports/model/version-summary.ts) projects content from `detail.version`: scope, cut-off, source quality, policy/content revision, overview paragraph, KPIs, charts, findings, recommendations, limitations, evidence and artifact metadata. It rejects mismatched identity and never uses `summary.latestVersion` in place of the selected version. Without a persisted version it returns `null`.

Legacy KPIs come from numeric/null rows of a metric table. Comparison tables are not turned into percentage deltas. Missing values show `—`; nothing is set to 0 and no new insight/recommendation is generated.

## Compact overview

[`deriveReportDashboardView`](../frontend/src/features/reports/model/dashboard-view.ts) only chooses presentation and never changes the stored version. For schema v1, the main area holds the opening paragraph if the first block is text, the first metric-grid, at most two suitable charts, and the first finding or a section containing only findings. Remaining blocks still show in the supporting area; nested sections are kept.

Compact charts have at most four series. Label limits depend on type: heatmap 8, pie/donut 6, horizontal bar 8, others 40. These are selection criteria for the highlight area; charts that do not qualify remain in the supporting area. The legacy summary uses two charts and the first finding, keeping the rest for further reading.

`ReportKpis` is shared by schema and legacy and shows exact definitions and values on first render. There is no count-up. The viewer header keeps version, scope, cut-off and source quality. When the content container is wide enough, charts sit side by side; narrow screens stack them.

## Full document

`ReportDocument` reads legacy sections or passes schema sections to the lazy `ReportBlocks` module. The reader keeps the stored author order and has a table of contents, anchors, evidence provenance, methodology and limitations. Schema and legacy share `ReportChart`/`ChartRenderer` for matching charts.

The schema does not choose a layout per `reportTypeId`; blocks decide the content. An unsupported schema version shows a warning and falls back to legacy if the stored version provides it. Unsupported new blocks show a visible diagnostic. Decoder and chart fallback rules are in [14f](14f-report-schema.md).

Wide tables scroll within their area; large tables paginate. Charts have a legend, values/units and an equivalent data table. Lines keep null gaps. Plots may shorten labels but tables/tooltips keep the original labels.

## Chart expansion

`ChartRenderer` has `compact`, `reading` and `expanded` presentations sharing data and registry. A chart's data table mounts when its disclosure opens; defaults are 25 rows/page in compact and 100 in reading/expanded.

[`ChartExpansion`](../frontend/src/shared/charts/ChartExpansion.tsx) moves the existing panel into a portal slot inside the viewer, keeps the compatible chart-type selection, makes background content inert, focuses the collapse button and restores scroll/focus on close. Escape collapses the chart before closing the dialog. Changing report, version or mode ends the expansion.

## Artifact downloads

[`ReportArtifactActions`](../frontend/src/features/reports/components/ReportArtifactActions.tsx) sits in the header and is shared by both modes. The request carries the exact report/version/artifact; the response's version is checked before a Blob is created and downloaded. It has pending/error/success states, aborts stale work and revokes the object URL.

**Status:** Implemented (mock) for HTML/CSV; Planned for DOCX/PDF/XLSX.

The mock currently serves real HTML/CSV text per stored version. There is no PDF/DOCX export. A stored version without artifacts gets no fake file. Binary formats require changing the contract and the download adapter; see [14c](14c-frontend-adapters.md).

## States and generation

| Situation | Behaviour |
| --- | --- |
| Report/version not found | Missing-data state; never silently swapped for another version. |
| Not permitted | Denied state at service/viewer. |
| Read error | Message and retry. |
| Draft or generation without a stored version | Shows the lifecycle; no fake document or download. |
| New generation failed/running but a stored version exists | The earlier stored version stays available; the attempt is shown separately. |
| No chart/KPI/evidence/artifact | Empty collections handled per content type; no generated numbers. |
| Unknown schema version | Warning and legacy content if present. |
| Unknown/incompatible/over-capacity chart | Keeps the original data table readable. |

A record with a persisted version counts as completed even if the latest attempt failed. Without a version: queued/running → generating; failed → failed; succeeded but missing output, or unknown → unsupported; no attempt → draft. The logic is in [`lifecycle.ts`](../frontend/src/features/reports/model/lifecycle.ts).

## Motion and tests

Motion uses GSAP and `@gsap/react`, managed by context in `useAnalyticalMotion`. Content/KPIs and each chart family own their effects. Bars reveal from the zero origin, lines keep gaps, radial/scatter/heatmap reveal by opacity. Cleanup runs on identity, mode, type or expansion change and on unmount; reduced motion skips reveals and shows the final content immediately.

Related tests: [`workspace.test.tsx`](../frontend/src/features/reports/tests/workspace.test.tsx), [`version-summary.test.ts`](../frontend/src/features/reports/tests/version-summary.test.ts), [`dashboard-view.test.ts`](../frontend/src/features/reports/tests/dashboard-view.test.ts), [`reports-viewer.spec.ts`](../frontend/tests/reports-viewer.spec.ts), [`report-schema.spec.ts`](../frontend/tests/report-schema.spec.ts), [`compact-dashboard.spec.ts`](../frontend/tests/compact-dashboard.spec.ts), [`riverside.spec.ts`](../frontend/tests/riverside.spec.ts). They cover different parts of projection, history, download, schema, focus, motion and viewport; how to run them is in [14g](14g-frontend-development.md).

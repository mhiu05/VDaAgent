# Plan

Replace the published-report preview's long, detail-first layout with a responsive decision dashboard backed only by existing report artifacts, ChartSpec payloads, and Decision Intelligence data. A local presentation adapter will prioritize the agent-v1 pack, progressively fall back to legacy report data, and keep every interaction connected to the established evidence drawer rather than adding a data source, API, database schema, or analytics logic.

## Scope

- In: A dashboard overview, typed presentation adapter, inline drill-down workspace, ChartSpec card interactions, evidence access, legacy-compatible fallback states, responsive/accessibility styling, and focused frontend tests.
- Out: Database migrations, canonical contract changes, API additions, new charting/state dependencies, Power BI embedding/assets, metric calculations in React, and scope-changing re-analysis from the report screen.

## Action items

[ ] Add `src/frontend/src/components/report-dashboard-model.ts` to derive display-only dashboard header, KPI, visual, priority, quality, and drill-down models from canonical payloads.
[ ] Add `src/frontend/src/components/report-dashboard.tsx` with a dashboard-first overview, explicit unavailable states, and a bounded inline detail workspace with breadcrumb/back/evidence controls.
[ ] Reuse existing `ChartRenderer` for all dashboard visuals and add an optional accessible card-level drill-down callback without changing ChartSpec numeric data or provenance.
[ ] Replace the default `ReportBody` preview hierarchy in `src/frontend/src/components/analysis-result.tsx` with the dashboard while preserving its established props and report export/print shell.
[ ] Add targeted styles in `src/frontend/src/app/globals.css` for a restrained responsive grid, KPI hierarchy, priority/quality panels, selected states, and mobile/print behavior.
[ ] Preserve canonical decision drilldowns where present; apply only local presentation filters to already-hydrated units, and explicitly identify any action that would require a new scoped run.
[ ] Implement progressive fallbacks for decision-intelligence reports, decision-brief/legacy reports, missing visual evidence, unavailable metrics, missing drilldowns, and empty priorities.
[ ] Add component tests for rich dashboard rendering, legacy fallback, unavailable values, supported chart/priority drill-down, breadcrumbs/back navigation, and evidence references.
[ ] Run the focused Vitest tests, then workspace typecheck, lint, and build; use a Playwright browser check if the local app can be started with the available environment.

## Open questions

- None. The current report, artifact, decision-intelligence, and evidence contracts contain the inputs required for this presentation-only change.

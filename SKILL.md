---
name: profiling-platform-ui-design
description: Design guidance for building a responsive data profiling platform UI with source configuration, CSV/Excel upload, PostgreSQL/SQL Server connectors, profiling workflow, statistical tests, reports, charts, and an agent chat assistant. Use when designing or implementing frontend UX for this project.
---

# Profiling Platform UI Design

## Product Shape

Build the UI as a data profiling platform for Data Analysts. The primary experience is a structured workflow for configuring sources, selecting datasets, running profiling, viewing reports, and running statistical tests. The chat agent is a supportive assistant, not the main navigation.

Use a quiet, professional dashboard style: clear navigation, dense but readable tables, useful charts, and action-oriented empty/error states. Avoid marketing-style landing pages.

## Core Layout

Use a three-zone layout on desktop:

- Left sidebar: workspace navigation, sources, jobs, reports.
- Main canvas: current workflow step or report.
- Right assistant panel: chat with agent, contextual suggestions, HITL confirmation.

On mobile/tablet:

- Collapse sidebar into a drawer.
- Move chat agent into a bottom sheet or dedicated tab.
- Keep tables horizontally scrollable and filters in drawers.

## Main Navigation

Provide these primary sections:

- Data Sources
- Profiling Jobs
- Results & Reports
- Statistical Tests
- Agent Chat
- Settings

Keep labels concrete. Use `Run profiling`, `Test connection`, `Preview data`, `View report`, `Run test`.

## Workflow

Use a wizard for profiling:

1. Source
2. Dataset
3. Columns
4. Configuration
5. Results

Show step status clearly: completed, current, blocked, failed. Do not use fake progress percentages unless backend provides real progress.

## Data Source Selection

Represent each source type as a selectable card:

- PostgreSQL
- SQL Server / Azure SQL
- CSV
- Excel
- Parquet

Each card should show:

- Icon
- Source name
- Short description
- Supported capabilities
- Connection/upload status

Examples:

- PostgreSQL: database connector, query pushdown, schema/table discovery.
- SQL Server: SQL Server/Azure SQL connector, query pushdown, table preview.
- CSV: file upload, DuckDB profiling.
- Excel: workbook upload, sheet selection, DuckDB profiling per sheet.
- Parquet: file upload, columnar profiling.

## Connection UX

Database source form fields:

- Host
- Port
- Database name
- Username
- Password
- SSL mode
- Auth type
- Optional advanced fields for cloud auth/certificates

Auth type should be a select control:

- Username/password
- Azure AD token
- AWS IAM
- GCP service account
- Client certificate

Always include `Test connection` before continuing. Do not show saved passwords or full connection strings. Show readable errors:

- Authentication rejected.
- Firewall or network blocked.
- Database not found.
- Driver missing.
- SSL/certificate error.

## File Upload UX

Use drag-and-drop and a file picker. Show:

- File name
- File size
- File type
- Upload progress
- Validation status

For CSV/Parquet, show preview after upload. For Excel, list sheets and allow selecting one or multiple sheets. For multiple CSV uploads, show each file as a row/card and infer relationship candidates across files.

## Dataset Selection

For database sources, show:

- Schema
- Table
- Estimated row count
- Column count
- Last profiled time
- Read-only/read-write status if known

For file sources, show:

- File/sheet name
- Row count
- Column count
- Preview
- Detected delimiter/type if relevant

Allow search and filtering. In MVP, one profiling job can focus on one dataset, but multi-file/multi-sheet profiling should show a collection view.

## Column Selection

Use a table:

| Select | Column | Type | Nullable | Sample value | Role |
|---|---|---|---|---|---|

Controls:

- Select all
- Deselect all
- Search column
- Filter by data type
- Mark as ID candidate
- Mark as categorical
- Exclude from profiling

Default to all columns selected. Warn if the dataset is very wide.

## Profiling Configuration

Group options into Basic and Advanced.

Basic:

- Basic statistics
- Null analysis
- Distinct analysis
- Duplicate detection
- Numeric distribution
- String length analysis
- Pattern detection

Advanced:

- Sampling
- Sample size
- Outlier method
- Null warning threshold
- Top values threshold
- Correlation settings
- PII detection

Explain technical terms with tooltips, not long inline text.

## Running State

Show:

- Job status
- Dataset name
- Source type
- Columns processed
- Start time
- Duration
- Cancel button

Statuses:

- Queued
- Running
- Completed
- Failed
- Cancelled

Use skeletons and status messages. Do not leave blank pages.

## Results & Reports

Use three levels:

1. Dataset overview
2. Column summary
3. Column detail

Dataset overview:

- Row count
- Column count
- Missing cells
- Duplicate rows if available
- Warning count
- Critical count
- Profiling duration
- Data quality score only if formula is explicit

Column summary table:

| Column | Type | Null % | Distinct % | Min | Max | Warning |
|---|---|---:|---:|---|---|---|

Column detail:

- Null count and ratio
- Distinct count and ratio
- Min / max
- Mean / median
- p25 / p75
- Outlier summary
- Top values when categorical
- Sample values
- Pattern issues
- PII candidates

## Visualization Rules

Use charts that match data type.

Numeric:

- Histogram
- Box plot
- Min/mean/median markers
- Outlier summary

Categorical:

- Top values bar chart
- Rare values table
- Distinct count

Date/time:

- Min/max date
- Distribution by month/year
- Missing periods

Text:

- Length distribution
- Empty string count
- Common pattern table
- Example values

Avoid pie charts for many categories. Avoid decorative charts that do not answer a profiling question.

## Statistical Tests UI

Provide a Statistical Tests page with two modes:

- Single test
- Batch tests

Single test cards:

- Pearson correlation
- Spearman correlation
- Independent t-test
- Chi-square independence
- One-way ANOVA

Each test card should show:

- Purpose
- Required columns
- Assumptions
- Output interpretation

Inputs:

- Dataset
- Test type
- X column / Y column
- Value column / Group column
- Alpha threshold

Batch mode:

- Allow adding multiple test rows.
- Each row has test type and required columns.
- Validate each row before running.
- Show results and errors separately.

Statistical test results should include:

- Statistic
- p-value
- Alpha
- Significant / not significant
- Sample size
- Group sizes
- Plain-language interpretation
- Chart when useful

Charts:

- Pearson/Spearman: scatter plot with trend line.
- t-test: grouped box plot or violin plot.
- ANOVA: grouped box plot.
- Chi-square: heatmap or stacked bar chart.

## Agent Chat UX

The agent chat should help users:

- Choose source type.
- Explain profiling results.
- Suggest which statistical test to run.
- Ask HITL confirmation for ID/PII/relationships.
- Answer questions about reports.
- Recommend next cleaning steps.

Do not make chat the only way to use the product. Every critical workflow must be possible through visible UI controls.

Good chat actions:

- “Explain why this column is warning.”
- “Which columns should I inspect first?”
- “Is `customer_id` likely a relationship key?”
- “Suggest statistical tests for this dataset.”

Agent messages should link to relevant table rows/charts when possible.

## HITL Confirmation

Use HITL for uncertain claims:

- Primary key candidate
- Foreign key relationship
- PII candidate
- Duplicate identifier
- Invalid range
- Business rule violation

Render HITL as compact confirmation cards:

- Claim
- Evidence
- Confidence
- Confirm / Reject / Edit

Never silently write uncertain claims into metadata without confirmation.

## Severity Display

Every issue must show severity with icon and text:

- Info: useful insight, no immediate action required.
- Warning: likely quality issue, user should inspect.
- Critical: serious issue that can invalidate profiling or downstream analysis.

Do not rely on color only.

Examples:

- Null rate 2%: Info.
- Null rate 30%: Warning.
- Declared primary key has duplicates: Critical.

## Empty, Loading, And Error States

Empty states:

- No data source: show `Add data source`.
- No profiling result: show `Run profiling`.
- No issues: show `No data quality issues detected`.

Loading states:

- Use skeleton for table/schema loading.
- Use job status for profiling.
- Use spinner only for short operations.

Error states must explain:

- What failed.
- Likely cause.
- Next action.

Avoid generic `Error 500`.

## Security UX

- Mask passwords.
- Never render full connection strings.
- Do not log secrets in UI.
- Limit data preview rows.
- Warn when PII candidates are detected.
- Allow deleting saved connections.
- Show whether a connection is read-only if known.

## Performance UX

For large datasets:

- Show estimated row count.
- Warn before full profiling.
- Recommend sampling.
- Let user select sample size.
- Use pagination or virtualization for tables.
- Never load full dataset into the browser.

Example warning:

> This table contains approximately 80 million rows. Full profiling may take a long time. Consider sampling.

## Accessibility

- Label every input.
- Support keyboard navigation.
- Keep contrast readable.
- Put field errors near fields.
- Use icons plus text.
- Ensure charts have text summaries.

## Responsive Design

Desktop is primary. On smaller screens:

- Collapse sidebar.
- Move filters into drawers.
- Let tables scroll horizontally.
- Stack charts vertically.
- Keep primary actions sticky when useful.

## Visual Style

Use a refined analytics-platform aesthetic:

- Neutral background.
- High-contrast text.
- Clear cards for selectable sources only.
- Dense tables with comfortable spacing.
- Subtle severity colors.
- Consistent chart palette.

Avoid nested cards, decorative blobs, oversized hero sections, and purely ornamental visuals.

## MVP Scope

MVP should include:

- Data source selection.
- PostgreSQL and SQL Server connection forms.
- CSV and Excel upload.
- Dataset/schema preview.
- Column selection.
- Profiling configuration.
- Profiling result dashboard.
- Statistical tests page.
- Agent chat assistant.
- HITL confirmation cards.

Defer:

- Complex RBAC.
- Collaboration/comments.
- Scheduling.
- Automated remediation.
- Real-time streaming charts.

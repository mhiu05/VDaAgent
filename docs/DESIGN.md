# Data Profiling Agent UI Design System

## Direction

Build the product like an AI-native data design canvas:
- Left navigation behaves like a project rail.
- Center workspace is a bright canvas for configuration, profiling, reports, and analysis.
- Right panel is a quiet assistant surface for contextual chat, HITL, and report help.
- UI should feel calm, precise, and production-ready rather than decorative.

## Palette

- Canvas background: `#F6F8FC`
- Surface: `#FFFFFF`
- Primary text: `#0F172A`
- Muted text: `#64748B`
- Border: `#DBE3EF`
- Primary interaction: `#2563EB`
- Analytics accent: `#0F766E`
- Success: green only for successful/healthy states
- Warning: amber only for review/risk states
- Error: red only for failures
- Info: blue/cyan for neutral informational state

## Layout

- Keep the existing three-zone structure: sidebar, workspace, assistant.
- Use the central area as a canvas with restrained grid texture and light surfaces.
- Prefer compact tables and data-dense panels over decorative card stacks.
- Keep cards and panels at `8px` radius.
- Avoid nested cards unless the inner card is a repeated item or a genuine framed tool.

## Components

- Selected items use a subtle blue tint plus one left accent edge.
- Primary actions use solid blue.
- Secondary actions use white surface with neutral border.
- Agent/chat surfaces should stay quiet and compact.
- Empty states should explain the next action and include one clear CTA when useful.

## Tables And Reports

- Report pages prioritize:
  1. Overview
  2. Column Summary
  3. Findings
- Use sticky-looking headers, restrained hover state, and fixed widths for long values.
- Do not show null or irrelevant fields in summary tables.
- Column details are drill-down, not part of the main summary table.

## Copy

- Interface language should be English.
- Use concise labels.
- Explain technical options through helper text or tooltips, not long paragraphs.

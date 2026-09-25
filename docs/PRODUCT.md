# Product truth

VDaAgent helps real estate teams inspect inventory, identify slow-moving units, run evidence-backed analysis, and publish reports that can be traced to their source data.

## Core workflow

`Data → Analysis → Evidence → Insight → Report`

- A workspace is tenant-scoped. Navigation and requests retain the active `org_id`.
- Analysis, artifacts, reports, imports, and scheduled work use the existing API and persisted records.
- Evidence lineage, permissions, chart meaning, report content, and data values are product behavior and must remain unchanged by visual work.
- The assistant can explain workflow state, but generated findings remain grounded in the underlying analysis and evidence.

## People and tasks

- Owners manage workspace access and recurring reporting.
- Analysts import data, explore it, and create analysis runs and reports.
- Viewers inspect persisted analysis and reports without write actions.

## Product voice

Use concise Vietnamese interface copy. Keep technical IDs, hashes, schema names, and generated report text exact where they carry product meaning. Describe uncertainty and provisional assumptions plainly. The assistant persona is a calm data navigator; it does not add unsupported findings or decorative Japanese language.

## Boundaries

The Sakura Signal work changes presentation and interaction styling only. It does not change routes, API contracts, database schemas, authentication or authorization behavior, agent workflows, semantic calculations, evidence lineage, or report content.

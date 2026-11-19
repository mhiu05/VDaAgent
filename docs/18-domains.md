# 18 · Domains shipped with the PoC

Two domains prove that domains are separated. Each has its own credential sets and its own starter agents. **Depends on:** [12](12-auth-and-domains.md), [04](04-agent-folder.md), [05](05-agent-builder.md).

Starters are **minimal**: a prompt, library presets and credential sets. They don't come with skills or routines; users and agents add those over time. Below, each agent is described only by its objective. How it reaches that objective is up to the agent, its prompt and its folder; the code is the same for every agent.

## `fabrikam`: Fabrikam Sales Ops

**Who uses it.** Sales Ops staff analysing why units sell slowly, how they compare with similar units, and what to report to management.

**Data.** The DATA team's real-estate warehouse: PostgreSQL database `cdw`, read through a read-only role. Agents work only on the data that role can see; the domain decides the scope.

**Golden question.** *"Vì sao căn MAS-U03832 bán chậm? So sánh với các căn tương đồng, vẽ biểu đồ và xuất báo cáo."*

### Credential sets

| Set | Keys | Used by |
|---|---|---|
| `warehouse` | `WAREHOUSE_DSN` (`postgresql://<reader role>:<password>@<host>:<port>/cdw`), `WAREHOUSE_SNAPSHOT_ID` (e.g. `SNAP-20260630-01`) | data, compare |
| `web-search` | `TAVILY_API_KEY` | data (market news, optional) |

### Starters

| Slug | Display name | Objective | Presets | Credentials |
|---|---|---|---|---|
| `lead` (override) | Điều phối | Understand the user's question, split it into work for the team, combine the results into one clear answer in Vietnamese, and deliver it with charts and the report. Says what's missing instead of guessing | — | — |
| `data` | Data | Get the facts from the warehouse: a unit's attributes, sales history and status, its project and zone, candidate peer units, and market context. Report missing values as missing, never as zero | `data`, `postgres` | `warehouse`, `web-search` |
| `insight` | Insight | Explain why a unit sells slowly from the data provided: price position, attributes, sales friction. Present findings as correlations, not causes | `data`, `stats` | — |
| `compare` | Compare | Choose a fair peer group (same project or zone, similar net area and type, at least 5 peers), compare the unit with it, and report "not enough data to compare" rather than invent a group | `data`, `stats`, `postgres` | `warehouse` |
| `chart` | Chart | Turn findings into clear PNG charts with Vietnamese labels and units (e.g. price per m² vs peers) | `data`, `charts` | — |
| `report` | Report | Write a report draft (DOCX and PDF) with the question, the findings, the charts and the data caveats; every number comes from the files the team produced. Publishes it to the user's reports library with `contoso.start_report` / `contoso.publish_report` (schema v1 payload plus the DOCX/PDF artifacts, [19](19-reports-dashboard-notifications.md)) | `documents` | — |

### Domain catalog rows

The domain catalog has no skills of its own yet. It uses the global `xlsx`, `docx`, `pdf` and `pptx` skills. A later `fabrikam` skill could be a data dictionary of the warehouse tables; it would be a GitHub repo listed in `domains/fabrikam/seeds/skills.yaml`.

## Adding a domain

1. Create `domains/<id>/domain.yaml` with `{id, name}`.
2. Add `credentials/<set>.env.example` files (first line `# description: …`). The operator writes the matching `<set>.env`.
3. Add `starters/<slug>/agent.yaml` and `prompt.md`, and optionally `starters/lead/prompt.md`.
4. Optionally add `seeds/skills.yaml` and `seeds/library_presets.yaml`.
5. Restart `api`. The domain is validated and appears in the admin's "Tạo người dùng" dialog.

Starters apply only to users created afterwards. Existing users aren't changed (see [99](99-risks-and-future-work.md#poc-shortcuts-and-future-work)).

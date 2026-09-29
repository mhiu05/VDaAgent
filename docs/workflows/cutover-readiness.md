# Pre-Deployment Production Gates

Repository implementation and the local product do not depend on these gates. Complete them before the first production deployment or a cutover from an older deployed environment. Run commands from the repository root. Record the observation time and source for each result. Do not print credentials or use a remote project for E2E.

## Known inventory (2026-09-29)

| Environment / target | Identity evidence | P1 database audit | P2 evidence |
|---|---|---|---|
| Local Supabase | CLI loopback API/DB URLs | active_runs=[], legacy_linked_jobs=[], legacy_live_leases=[] at 2026-09-29 00:35 UTC | Local test only |
| Application project cqtjbhxkivbxrgvogvnb | .env API host and DB pooler username match the ref; connected Supabase project URL matches | active_runs=[], legacy_linked_jobs=[], legacy_live_leases=[] at 2026-09-29 00:35 UTC; runs_guard_workflow_version enabled in prior audit | No deployed frontend or web/API access logs identified |
| Warehouse project xmwzoxgvqjwtggucacwl | .env warehouse API and direct DB hosts match the ref; repository uses WAREHOUSE_DB_URL only for mock-data import/validation | Not established as an application worker target; read-only schema probe unavailable (ENOENT), so no P1 audit claim | Not established as an application API target |
| GitHub repository | gh api returned no deployments, environments or Actions workflows | No worker inventory | No deployment/client inventory |

The local and known development application audits support retiring executable legacy code in this repository. They do not prove that other deployments do not exist. The .env filename does not identify a production environment. Available Supabase logs cover Supabase services, not the Next web/API deployment path.

## Gate P1 — Legacy production drain

For each deployed application database, verify the API project ref and database identity before running:

    node --env-file=<verified-env-file> scripts/maintenance/audit-readiness.mjs --expect-project=<verified-project-ref>

For local Supabase, use the loopback-only procedure in [verification.md](verification.md). The audit uses a read-only transaction. Record:

    Environment:
    Project ref:
    Database URL identity verified by:
    Current worker deployment ID / release:
    Legacy worker deployment ID / release:
    Legacy worker replicas or active processes:
    Audit command and observed_at:
    active_runs (legacy-v1, missing or invalid version):
    legacy_linked_jobs (queued/running/waiting or live lease):
    legacy_live_leases:
    Old worker drain evidence (provider, timestamp, link or log reference):
    Result:

Accept P1 only when all deployed application projects are inventoried; each audit shows zero nonterminal legacy or missing-version runs, legacy_linked_jobs=[], and legacy_live_leases=[]; no deployed producer creates legacy-v1 runs; and the deployment owner confirms every old worker process or container has stopped or drained. Current repository code creates and claims only agent-v1 work; its historical readers remain. If an older deployed environment still has active legacy work, drain or retire it with that environment's appropriate prior release before deploying the canonical worker. Do not relabel historical runs or delete historical data.

## Gate P2 — External API consumer audit

Repository and GitHub inventory commands:

    rg -n '/api/v1' src scripts tests -g '!*.json'
    gh api repos/mhiu05/VDaAgent/deployments --jq '.[] | {id, environment, created_at, ref}'
    gh api repos/mhiu05/VDaAgent/environments --jq '.environments[]? | {name, id}'
    gh api repos/mhiu05/VDaAgent/actions/workflows --jq '.workflows[]? | {name, path, state}'

For each active web/API deployment, record its URL, release SHA, served frontend assets, API gateway/reverse proxy, callbacks, integration clients and access-log source. Search the served assets for /api/v1; source search is insufficient. Query the actual web/API access logs over a window covering the retained old assets and client release horizon, using the source's equivalent of:

    path LIKE '/api/v1%'

Record:

    Deployment URL / environment / release SHA:
    Frontend assets inspected and /api/v1 matches:
    External clients and callback configuration:
    Access-log source:
    Observation window (UTC) and retention:
    Requests to /api/v1 (count and caller classification):
    Old asset/download-link expiry confirmed:
    Result:

Accept P2 only when all active deployments and integrations are inventoried, served assets use /api/*, no configured external client requires /api/v1, and access logs show no live /api/v1 consumer through an adequate observation window. Keep /api/* canonical; no versioned compatibility route is part of the local product.

## Cutover record

| Environment | Project ref / deployment | Evidence link or command output | P1 audited? | P2 audited? | Owner |
|---|---|---|---|---|---|
| | | | | | |

Current decision: repository/local implementation complete. Production deployment has not been performed; P1 and P2 are deferred until that deployment.

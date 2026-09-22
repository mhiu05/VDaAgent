# MVP local setup

VDaAgent MVP has one supported runtime: Supabase Auth, PostgreSQL, and Storage.
The documented path is a disposable local Supabase stack. It is not a deployment
guide for a hosted production project, and the MVP does not include remote
deployment or external report delivery.

## Prerequisites

- Node.js 24 or later and pnpm 11.0.8.
- Docker Desktop, or a container runtime compatible with the Docker API.
- Supabase CLI, available through the repository dependency (`pnpm exec supabase`).

## Start a local stack

From the repository root, install dependencies and prepare the local database:

```sh
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:reset
```

`pnpm db:reset` is for the disposable local stack only. It applies the local
migration and seed workflow, so do not point it at a hosted project or any
database containing data that must be retained.

Create `.env` from `.env.example`, then obtain the local connection values with:

```sh
pnpm exec supabase --workdir src/backend status --output env
```

Set the matching values in `.env` for `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and
`SUPABASE_DB_URL`. Browser code uses only the publishable key. The secret key,
database URL, and provider API keys belong only to server or worker processes;
never commit, log, or place them in a `NEXT_PUBLIC_*` variable.

The default provider configuration is Gemini primary with OpenAI fallback. A
local developer needs valid provider configuration for normal application
execution; the automated E2E harness supplies its own deterministic fixture and
local-only values.

Run the web application and worker together with:

```sh
pnpm dev
```

For separate processes, use `pnpm dev:web` and `pnpm dev:worker`. Long-running
analysis is claimed by the worker; opening the web application alone does not
replace that process.

## Workflow rollout setting

`AGENT_WORKFLOW_ENABLED` is `false` in `.env.example`. When it is false, newly
created runs use the legacy workflow. Setting it to `true` opts new runs into
the persisted `agent-v1` workflow; the worker dispatches from each run's stored
workflow version, so already queued legacy runs remain legacy. Turn the flag
back off to stop new opt-ins while retaining existing persisted artifacts and
reports.

`DEVELOPMENT_ROLE_BYPASS` is a local-development aid only and is rejected in
production. Real users and organization membership are still server-authorized
through Supabase Auth and the repository boundary.

## Schema and data safety

Make schema changes in `src/backend/supabase/schemas` first, generate and review
the corresponding migration with the Supabase CLI, and validate both fresh and
upgrade behavior on a disposable local database. Keep the declarative schema,
migration, RLS/grants, and test coverage aligned. Do not reset, seed, or run E2E
against a hosted production project.

Before relying on a local change, use the MVP validation commands in
`docs/23_Testing/MVP_Validation.md`. The intended operational model for any
future deployment must provide an always-running worker and scheduler cadence;
those production operations are outside the current MVP.

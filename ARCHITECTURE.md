# VDaAgent Architecture

VDaAgent is a workspace-scoped, evidence-first data profiling application.
Profile Run is the principal analytical context: every chart, agent answer,
comparison, report, audit event and trace belongs to a workspace and a Profile
Run. The application deliberately separates deterministic computation from LLM
planning and narrative generation.

## Architectural decisions

| Decision | Rationale |
| --- | --- |
| PostgreSQL is the metadata authority | It owns users, workspace membership, dataset metadata, runs, evidence, reports, audit and redacted traces. |
| File bytes live outside metadata DB | Supabase Storage, Google Drive, or local development storage persists uploaded data; compute materializes a temporary local file only when required. |
| Profiling is durable and asynchronous | FastAPI enqueues a job and returns 202; a separate worker claims it with a PostgreSQL lease. |
| Evidence is promoted, not inferred | Preview is ephemeral and bounded. Official execution is revalidated, persisted with context/result hash and is eligible for reporting. |
| LLM is bounded | It can plan charts and explain approved evidence, but cannot run arbitrary code or substitute for the compute engine. |
| FastAPI is the security boundary | It verifies identity, workspace membership and capability on protected requests. Frontend checks are UX only. |

## Runtime topology

~~~mermaid
flowchart TB
  Browser[Browser]

  subgraph Web[Next.js frontend]
    UI[Workspace UI]
    PDF[Server-side PDF route]
    UI --> PDF
  end

  subgraph Application[FastAPI API]
    AuthGuard[JWT + workspace + capability guard]
    Domain[Dataset, profile, chart, agent, report and admin routes]
    Repo[Repositories]
    Planner[Chart planner and Agent runtime]
    Engine[AnalysisEngine]
    AuthGuard --> Domain
    Domain --> Repo
    Domain --> Planner
    Domain --> Engine
  end

  subgraph WorkerProcess[Profiling worker]
    Claim[Claim job / renew lease]
    Graph[LangGraph profiling flow]
    Compute[DuckDB / pandas / statistics]
    Claim --> Graph --> Compute
  end

  subgraph Persistence[Persisted state]
    DB[(PostgreSQL / Supabase DB)]
    Storage[(Supabase Storage / Google Drive / local dev)]
  end

  subgraph Integrations[External integrations]
    Supabase[Supabase Auth]
    LLM[LLM provider]
    LangSmith[LangSmith optional]
    Sources[MySQL / MongoDB / DuckDB source]
  end

  Browser --> UI
  UI -->|Bearer token, X-Workspace-Id| AuthGuard
  UI --> Supabase
  PDF -->|authorized export source| Domain
  Repo --> DB
  Claim --> DB
  Graph --> DB
  Compute <-->|temporary materialization| Storage
  Domain --> Storage
  Domain --> Sources
  Planner --> LLM
  Planner -. sanitized metadata, fail-open .-> LangSmith
~~~

The frontend has no access to server credentials. Its public configuration is
embedded at build time through an allow-listed NEXT_PUBLIC_* set. The API
receives the Supabase access token and workspace context, then resolves the
effective permission before performing any protected action.

## Deployment topology

Production is split into three Azure App Service processes:

1. Frontend: Next.js standalone image on port 8080.
2. API: FastAPI image on port 8000.
3. Profiling worker: the API image with the profiling-worker startup command
   and a worker health endpoint.

GitHub Actions validates backend and frontend quality, builds immutable images,
runs Alembic migration, updates App Service settings, restarts the three
processes and polls their health endpoints. Database secrets, provider keys,
storage credentials and OAuth secrets remain in GitHub/Azure secret stores.

## Identity, authorization and tenancy

Supabase Auth owns browser identity and session. The backend verifies bearer
tokens against Supabase JWT/JWKS, synchronizes the user profile, checks account
status and resolves a workspace.

There are two independent role concepts:

| Scope | Role / authority |
| --- | --- |
| System | user_profiles.role: analyst or admin. Admin grants user-account/system management capabilities. |
| Workspace | Membership is normalized to analyst and grants workspace analytical capabilities. |

A system admin does not inherit Analyst workspace capabilities. A workspace
invitation never grants system admin. A locked or deleted permanent account is
rejected by the backend even when its JWT has not expired.

Protected API requests carry a Bearer token and, where relevant, an
X-Workspace-Id. The ID itself is never authorization: the backend checks that
the current user has an eligible membership and required capability. Audit
events are persisted for sensitive operations.

## Data ownership and handling

| Data | System of record | Handling |
| --- | --- | --- |
| Identity/session | Supabase Auth | Supabase SSR/PKCE in browser; token validated by API. |
| User/system role | PostgreSQL user_profiles | Email projection, role, status and lock metadata. |
| Workspace/membership | PostgreSQL | All protected resource lookups are workspace-scoped. |
| Dataset binary | Configured storage provider | Metadata stores source reference and SHA-256; compute receives a temporary materialization. |
| Datasource credentials | PostgreSQL metadata | Fernet-encrypted with DATASOURCE_ENCRYPTION_KEY; never returned to browser. |
| Profile statistics/review | PostgreSQL | Bound to dataset, workspace and Profile Run. |
| Explorer execution | PostgreSQL | Stores query specification, context version, result hash, limitations and provenance. |
| Agent trace | PostgreSQL | Redacted provenance only; never chain-of-thought, raw rows, raw prompts or secrets. |
| Report draft/snapshot | PostgreSQL | Draft is editable; snapshot is immutable and preferred for export. |

External datasources are intentionally narrow. MySQL and DuckDB accept a table
or validated read-only SELECT/WITH source; MongoDB accepts a collection and JSON
filter. Materialization is capped at 1,000,000 rows. BigQuery, Snowflake and a
general vector database are not runtime compute backends.

## Core flows

### 1. Sign-in and workspace bootstrap

~~~mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant UI as Next.js
  participant SA as Supabase Auth
  participant API as FastAPI
  participant DB as PostgreSQL

  U->>UI: Sign in with email/password
  UI->>SA: Authenticate using Supabase client
  SA-->>UI: Session and access token
  UI->>API: GET /workspace-bootstrap with Bearer token
  API->>SA: Verify JWT/JWKS
  API->>DB: Sync user, check account status and membership
  API-->>UI: User, selected workspace, permissions and dashboard summary
~~~

Signup, email confirmation and password reset use Supabase callback routes.
Production requires AUTH_MODE=supabase and confirmed email. Guest mode is
enforced twice: AUTH_ALLOW_GUEST controls backend behavior and
NEXT_PUBLIC_AUTH_ALLOW_GUEST controls UI/middleware at frontend build time.

### 2. Dataset upload and profiling job

~~~mermaid
sequenceDiagram
  autonumber
  actor A as Analyst
  participant UI as Next.js
  participant API as FastAPI
  participant Store as Storage
  participant DB as PostgreSQL
  participant Worker as Profiling worker
  participant Graph as Profiling graph

  A->>UI: Upload dataset or select validated connector
  UI->>API: POST /datasets/upload or datasource endpoint
  API->>Store: Persist binary or source reference
  API->>DB: Save workspace-scoped dataset metadata and audit
  A->>UI: Start Profile Run
  UI->>API: POST /profile with Idempotency-Key
  API->>DB: Create queued run/job
  API-->>UI: 202 Accepted and job id
  Worker->>DB: Claim with SKIP LOCKED and lease
  Worker->>Graph: Run deterministic profiling
  Graph->>DB: Persist stats, proposals and provenance
  Worker->>DB: Mark succeeded or pending review
  A->>API: PATCH /profile/{runId}/confirm
  API->>DB: Save decisions and enqueue continuation
  Worker->>Graph: Resume from checkpoint and complete run
~~~

Job state (queued, running, succeeded, failed) is separate from Profile Run
state. The API never executes the profiling graph inside an HTTP request.
Worker lease renewal and bounded retry protect against a process restart or a
transient database error. Cancellation is not exposed because the compute stack
has no common cooperative cancellation boundary.

### 3. Chart planning and Official evidence

~~~mermaid
sequenceDiagram
  autonumber
  actor A as Analyst
  participant UI as Command Center
  participant API as FastAPI
  participant Plan as Chart planner
  participant Engine as AnalysisEngine
  participant DB as PostgreSQL
  participant Agent as Insight runtime

  A->>UI: Select completed Profile Run and ask a chart question
  UI->>API: Create/get Explorer session
  UI->>API: Request auto-plan or profile pack
  API->>Plan: Safe profile metadata only
  Plan-->>API: Structured plan or deterministic fallback
  UI->>API: Run Preview
  API->>Engine: Validate QuerySpec and execute bounded analysis
  Engine-->>UI: Preview result and limitations
  A->>UI: Promote Preview
  UI->>API: Promote request
  API->>Engine: Revalidate context/quality gate and rerun Official
  Engine->>DB: Persist result hash and provenance
  UI->>Agent: Generate evidence-bound insight
  A->>API: Review/edit and pin to report draft
~~~

AnalysisEngine validates columns, analysis kind, aggregation, time grain,
filters, PII policy, budgets, timeout, context version and idempotency.
Preview may be approximate or expire; Official evidence is the only durable
chart result. The current release renders 15 native chart types and exposes a
28-model forecast registry, with models disabled when dependency or data
contracts are not available.

### 4. Report and export

~~~mermaid
sequenceDiagram
  autonumber
  actor A as Analyst
  participant UI as Next.js
  participant API as FastAPI
  participant DB as PostgreSQL
  participant PDF as Server PDF route

  A->>UI: Pin reviewed Official evidence or note
  UI->>API: Add report draft item with idempotency key
  A->>UI: Create snapshot
  UI->>API: Create immutable snapshot
  API->>DB: Persist report version and snapshot hash
  A->>PDF: Request profile report PDF
  PDF->>API: Get authorized export source
  API-->>PDF: Snapshot or read-only draft fallback
  PDF-->>A: Rendered PDF
~~~

A pre-snapshot draft may be shown for convenience but is not an official,
shareable report. Report lifecycle endpoints support submit, review, publish
and archive once a snapshot exists.

## Agent, trace and MCP boundaries

Agent Q&A is bound to an authorized Profile Run. The backend caps short-term
conversation history and applies output guardrails. Missing evidence must remain
a stated limitation rather than be presented as a verified conclusion.

AGENT_TRACE_MODE=shadow records redacted provenance without becoming the source
of analytical results. LangSmith projection is optional, metadata-only and
fail-open. PostgreSQL remains authoritative. The FastMCP server is a stdio
adapter for trusted local processes; it is not a public API surface and follows
the same bounded profile/chart contracts.

## Operational safeguards

- DATASOURCE_ENCRYPTION_KEY is required in production before connector
  credentials are persisted.
- SUPABASE_SECRET_KEY/service role key, database credentials, OAuth secrets,
  LLM keys and encryption keys are server-only.
- Performance telemetry records only route templates, timings, query counts,
  payload sizes and sampled coarse SQL fingerprints. It excludes tokens,
  request bodies, SQL parameters, prompts, model output and raw rows.
- Server-Timing is disabled by default; it can be enabled deliberately for
  browser-side performance inspection.
- Supabase pooler session endpoint port 5432 is normalized to transaction
  endpoint port 6543 for API/worker connection pressure. Checkpointer and
  migration URLs can be configured separately.

## Deliberate product limits

- No arbitrary SQL, arbitrary code execution, raw-row explorer, multi-table
  join or data-cleaning recipe is available through UI, Agent, Explorer or MCP.
- PII masking and output guardrails are enforced before returning content to
  UI, reports or MCP callers.
- Forecasts are estimates with intervals and limitations, not facts.
- Planner autonomy, verifier enforcement and long-term personal/workspace
  memory are feature-gated, not default released workflows.

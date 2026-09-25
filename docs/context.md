# VDaAgent — Technical Context

> Snapshot: 2026-09-23. This describes the implementation present in this repository. Source code, tests, SQL schemas and migrations are evidence for behavior; product contracts and plans are labeled as such. A named “agent” is not necessarily an LLM. Unknown deployment or operational details are called out explicitly.

## Product Overview

VDaAgent is a workspace application for analyzing property inventory snapshots and presenting evidence-backed findings and reports. Its current MVP path is:

~~~text
Inventory snapshots → deterministic analysis → evidence and signals → decision brief → report
~~~

The code and product contract describe helping inventory and Sales Operations users understand stock levels, movement, aging, price distributions, concentrations and data limitations in a selected project/zone and date scope. This is an engineering description, not a claim that provisional rules are validated business policy.

The current seed/demo data is synthetic (Vinhomes Synthetic Demo). Import manifests and analytic artifacts are marked provisional. Snapshot-reported sales fields are not an authoritative transaction ledger. Workspace roles are owner, analyst and viewer. The intended operational audience is described in the [decision-intelligence product contract](decision_intelligence_product_contract.md); the app enforces workspace roles rather than a separate Sales Operations persona.

**Inputs:** organization and project scope, optional zone, data_as_of, question/use case, imported CSV inventory snapshots, and report schedule settings. Analysis is based on snapshots, not every table in the mock warehouse mapping.

The registered use-case contract currently contains slow_moving_inventory. Agent Chat also has a fixed set of focus values (current inventory, slow moving, inventory comparison, price distribution, peer comparison and full report); these route the request through supported paths and do not create arbitrary new use cases.

**Outputs:** immutable run artifacts (query and calculation lineage, comparisons, chart specifications, insights and decision-intelligence packs), a published report, JSON/CSV exports, and persisted conversation messages. Legacy Agent Chat messages use typed references to runs, reports, artifacts and signals; the feature-gated Agent Runtime additionally renders bounded text from server-owned canonical observations and retains typed grounding references. There is no application-generated PDF workflow.

## Repository and Runtime

This is a pnpm/Turborepo workspace with a Next.js web application, shared TypeScript packages, a Node worker, and Supabase SQL/configuration. The Next.js catch-all route invokes the server API in the same application process; the worker is a separate process.

| Area | Current implementation | Entry/configuration |
| --- | --- | --- |
| Runtime/package manager | Node.js >=24, pnpm 11.0.8, TypeScript 5.9.3, Turbo 2.11.2 | [package.json](../package.json), [pnpm-workspace.yaml](../pnpm-workspace.yaml), [turbo.json](../turbo.json) |
| Web | Next.js 16.3.5, React 19.3.0, App Router | [src/frontend/package.json](../src/frontend/package.json), [src/frontend/src/app/page.tsx](../src/frontend/src/app/page.tsx) |
| Server/API | Next.js Node route handler and in-process TypeScript packages | [catch-all route](../src/frontend/src/app/api/v1/%5B...path%5D/route.ts), [server API](../src/frontend/src/server/api.ts) |
| Database and identity | Supabase Auth, PostgreSQL 17 configuration, Supabase Storage | [Supabase config](../src/backend/supabase/config.toml), [database driver](../src/backend/packages/db/src/driver.ts) |
| Background execution | Node worker polling a PostgreSQL-backed queue; no separate broker | [worker](../src/backend/worker/src/index.ts), [repository](../src/backend/packages/db/src/repository.ts) |
| Contracts/domain | Zod contracts, deterministic domain and semantic packages | [contracts](../src/backend/packages/contracts/src/index.ts), [domain](../src/backend/packages/domain/src/index.ts), [semantics](../src/backend/packages/semantic/src/index.ts) |

### Workspace Packages

| Package | Role in the current architecture |
| --- | --- |
| @vda/contracts | Zod request, response, run, task, artifact, workflow and report schemas; also exports JSON Schema files. |
| @vda/config | Parses required server environment configuration and rejects unsupported provider combinations and unsafe public secret names. |
| @vda/db | PostgreSQL repository, authorization checks, idempotency, pinned snapshots, queue leases, conversations, artifacts, reports and storage access. |
| @vda/domain | CSV/hierarchy handling, integrity and claim validation, workflow artifact validation, report validation and deterministic decision-intelligence builder. |
| @vda/semantic | Canonical inventory metric, as-of selection, comparison, peer cohort, abstention and insight candidate logic. |
| @vda/agents | Legacy DAG, opt-in durable agent workflow, chart builder, provider adapters, legacy Agent Chat, feature-gated bounded Agent Runtime, and publication gate. |
| @vda/worker | Claims/renews run leases, dispatches by pinned workflow version and ticks schedules. |
| @vda/web | Next.js workspace UI, same-origin API/BFF, Supabase SSR auth and client rendering. |

## System Architecture

~~~mermaid
flowchart LR
  Browser[Browser: Next.js Workspace] -->|same-origin /api/v1| Route[Next catch-all route]
  Route --> Api[Server API + principal and role checks]
  Api --> Repo[SqlRepository]
  Repo --> Pg[(Supabase PostgreSQL)]
  Api --> Store[Supabase private Storage]
  Api --> LegacyChat[Legacy Agent Chat: default]
  Api --> Runtime[Agent Runtime: GROK_RUNTIME_ENABLED]
  LegacyChat --> LegacyProvider[Gemini → OpenAI structured decision]
  Runtime --> Context[Server-authorized workspace context]
  Context --> Registry[Closed capability registry]
  Registry --> RuntimeProvider[Gemini/OpenAI; optional xAI]
  Pg -->|queued run| Worker[Node worker: lease + fencing]
  Worker --> Legacy[legacy-v1 DAG]
  Worker --> V1[agent-v1 DAG, opt-in]
  Legacy --> Semantic[@vda/semantic]
  V1 --> Semantic
  V1 --> Decision[Deterministic decision-intelligence builder]
  Legacy --> Artifacts[Validated immutable artifacts]
  Decision --> Artifacts
  Artifacts --> Pg
  V1 --> Providers[Gemini / OpenAI structured providers]
  Legacy --> Providers
  Api --> Providers
~~~

Provider use is limited: models do not query PostgreSQL or produce canonical metrics/chart values. The API uses Supabase Auth for identity, while repository operations apply organization/role checks and PostgreSQL RLS. Analyses are enqueued and processed by the worker; the HTTP request does not execute the DAG synchronously. The browser polls for run, task, conversation and workflow state. When both `GROK_RUNTIME_ENABLED` and `GROK_SSE_ENABLED` are enabled, Agent Runtime turns may use same-origin POST-over-fetch SSE for safe activity and final-state events; JSON calls and run polling remain available as fallbacks. No Redis, Kafka, BullMQ or WebSocket service is present in runtime configuration.

Implementation: [request context](../src/frontend/src/server/context.ts), [server API](../src/frontend/src/server/api.ts), [repository](../src/backend/packages/db/src/repository.ts), [worker](../src/backend/worker/src/index.ts), [legacy executor](../src/backend/packages/agents/src/legacy-workflow/workflow.ts), [agent-v1 executor](../src/backend/packages/agents/src/analysis-v1/workflow.ts), [Agent Runtime](../src/backend/packages/agents/src/runtime/runtime.ts), and [Agent Runtime stream](../src/frontend/src/server/agent-turn-stream.ts).

## User Workflows

### Sign in and select a workspace

The root page renders the workspace shell. The client loads /setup and /session; Supabase email/password login is available. In development only, the setup response can enable signed role-grant buttons for local owner/analyst/viewer use. A user without an organization membership sees a no-access state. Organization switching is client state and remounts the workspace; tabs are not separate URL pages.

### Import inventory CSV

~~~text
Member → Imports tab → POST /api/v1/imports
       → body/schema and hierarchy validation
       → hash + private source upload + transactional manifest/snapshot insert
       → import list and manifest shown in UI
~~~

The UI reads the selected file as text and posts it as JSON with a source filename; its client limit is 2 MB. The server parses CSV, validates supported columns and hierarchy, rejects duplicate unit/date rows instead of overwriting, hashes the exact input for idempotency, uploads the original to private source-imports, and inserts an immutable import manifest and snapshot rows. Bulk mock warehouse scripts are a separate import path.

### Run a direct analysis

~~~text
Member → Analysis form → POST /api/v1/analyses (Idempotency-Key)
       → authorize + pin requested snapshot membership + enqueue run
       → worker claims lease → legacy-v1 or agent-v1 workflow
       → poll run/tasks/artifacts → render brief and evidence
~~~

The request specifies organization, project, optional zone, data_as_of, question and use case. A run pins its workflow version at creation. The worker claims queued or expired runs using PostgreSQL row locking, renews the lease and fences writes by worker ID/token. The legacy UI polls progress and supports cancellation.

### Agent Chat

~~~text
UI → POST /api/v1/conversations[/<id>/messages]
   → persist idempotent user turn + assistant placeholder
   → default: legacy one-decision / one-operation chat path
   → flagged: authorize workspace snapshot → validate bounded plan → execute capabilities
   → persist accepted turn/result → polling and artifact hydration
~~~

The default `AgentChatOrchestrator` persists an idempotent user turn and assistant placeholder, asks Gemini/OpenAI for one structured decision, then permits at most one typed operation: create analysis, retrieve an authorized run, inspect a supported signal, or return an unsupported response. Changing scope/date can force a new analysis; causal questions are rejected by deterministic routing.

When `GROK_RUNTIME_ENABLED=true`, `AgentRuntime` replaces that turn handler. It builds a server-authorized workspace context, validates an entire plan before executing it, permits at most three sequential read capabilities, and permits `create_analysis` only as the plan's sole mutating step. Capability outputs are canonical observations and allowlisted workspace actions. The composer may select only their IDs; the server re-authorizes their references and renders the final text. The UI also offers target selection, retry with the same idempotency identity, cancellation, bounded signal follow-ups, and optional activity presentation. Cancellation is an explicit UI/API operation, not an LLM decision.

### Reports and schedules

Members can open reports, inspect canonical artifacts and decision brief, export JSON/CSV, and use browser print styling. Members can create/edit/pause/enable/delete report definitions, trigger one immediately, or invoke a scheduler tick. The worker checks due schedules on a 60-second cadence; a separate scheduler:tick command and API endpoint also exist. Each scheduled occurrence is idempotently tied to its definition and scheduled time.

## Agent Architecture

“Agent” in this repository usually means a typed workflow stage. The coordinator, data, comparison, chart, analyst, insight, report and reviewer stages do not form a set of autonomous LLMs. Numeric data, schemas, evidence and publication are owned by deterministic code.

### Run workflows

The run's workflow_version is pinned at creation. AGENT_WORKFLOW_ENABLED defaults to false; changing the flag does not divert an already queued run.

~~~mermaid
flowchart TD
  subgraph LV1[legacy-v1]
    O[Orchestrator] --> D[Data] --> C[Calculation] --> CP[Comparison]
    CP --> CH[Chart] --> I[Insight] --> V[Validation] --> R[Report]
  end
  subgraph AV1[agent-v1, opt-in]
    CO[Coordinator] --> DA[Data]
    DA --> CB[Comparison branch]
    DA --> HB[Chart branch]
    DA --> AB[Analyst branch]
    CB --> IN[Insight + decision pack]
    HB --> IN
    AB --> IN
    IN --> DR[Report draft] --> RV[Reviewer]
    RV -->|PASS| PUB[Publication]
    RV -->|bounded revision| DR
  end
~~~

### Feature-gated Agent Runtime

This is separate from the `agent-v1` run workflow. It is selected per chat turn by `GROK_RUNTIME_ENABLED`, while `GROK_WORKSPACE_ENABLED` only selects the optional workspace layout and `GROK_SSE_ENABLED` only enables the optional presentation stream. The feature flags default to `false`.

~~~mermaid
flowchart LR
  C[Untrusted client workspace context] --> BFF[BFF route]
  BFF --> AC[AuthorizedAgentContextV1]
  AC --> P[One structured planner call]
  P --> V[Whole-plan preflight]
  V --> R[Closed registry: up to 3 sequential capabilities]
  R --> O[Canonical observations + allowed actions]
  O --> S[Provider selects IDs only]
  S --> G[Server validates, re-authorizes and renders]
  G --> M[Persisted assistant message]
  R -->|create_analysis only| Q[Existing run queue]
~~~

The registry has nine capability IDs: `create_analysis`, `get_analysis_result`, `inspect_signal`, `inspect_decision_intelligence`, `inspect_visual`, `inspect_priority_entity`, `inspect_evidence`, `get_report_context`, and `inspect_agent_checkpoint`. The server enforces a maximum of three plan/capability steps, one call per capability, one new run/mutation, twelve rendered observations, eight workspace actions, one logical planner call, one logical composer call, and a 45-second capped turn deadline. Provider attempts are capped at two per stage and use a configurable 12-second default attempt timeout. Provider-visible data is an already-authorized, size-bounded projection; plans, prompts and observation bundles are ephemeral rather than persisted.

### Stage responsibilities

| Stage | Inputs and outputs | Model use and failure/recovery |
| --- | --- | --- |
| Legacy orchestrator | Run request; creates the legacy task DAG and executes data, calculation, comparison, chart, insight, validation, report. | Deterministic orchestration. Failures persist on task/run; lease recovery uses repository checkpoints. [Legacy executor](../src/backend/packages/agents/src/index.ts) |
| Coordinator (agent-v1) | Authorized, pinned run → typed CoordinatorDecision and analysis_request; resolves registered use case, scope/date, capability and target. | Deterministic; no model, SQL or metric call. [Coordinator](../src/backend/packages/agents/src/analysis-v1/agents/coordinator-agent.ts) |
| Data | Pinned snapshot rows → query/query result, calculation, comparison calculation, compatibility comparison, DataAnalysisPack. | Reads through repository's fenced snapshot boundary; calls @vda/semantic; validates tenant, scope, values, refs and lineage. No model SQL/values. [Workflow](../src/backend/packages/agents/src/analysis-v1/dag.ts), [Data Agent](../src/backend/packages/agents/src/analysis-v1/agents/data-agent.ts) |
| Comparison, Chart, Analyst branches | Persisted Data pack → typed comparison, chart/visual evidence and analysis packs. Branches are independent after Data. | Deterministic projections and validation; artifacts reload by stable key on recovery. [Branch workflow](../src/backend/packages/agents/src/analysis-v1/stages/branches.ts) |
| Insight | Validated branch artifacts → insight and insight pack, then deterministic decision-intelligence pack. | Candidate selection, claim binding and policy are deterministic. Narrative provider can only select supplied claim IDs; see [Deterministic vs LLM Responsibilities](#deterministic-vs-llm-responsibilities). [Draft workflow](../src/backend/packages/agents/src/analysis-v1/stages/insight-report.ts), [decision builder](../src/backend/packages/domain/src/decision-intelligence/build-pack.ts) |
| Report | Validated insight/decision inputs → immutable report_draft revision. | Draft construction is deterministic and schema/evidence checked. [Report agent](../src/backend/packages/agents/src/analysis-v1/agents/report-agent.ts) |
| Reviewer | Draft plus exact artifact graph → review_result PASS or bounded evidence-wording correction. | Default reviewer provider is deterministic; one revision may be requested. A second non-PASS fails the run. [Reviewer](../src/backend/packages/agents/src/analysis-v1/agents/reviewer-agent.ts), [review workflow](../src/backend/packages/agents/src/analysis-v1/stages/reviewer.ts) |
| Publication | PASS review plus matching immutable draft → canonical report and successful run. | Fenced repository transaction is the publication authority; generic artifact writes cannot publish an agent-v1 report. [Publication](../src/backend/packages/agents/src/analysis-v1/stages/publication.ts), [repository](../src/backend/packages/db/src/repository.ts) |
| Legacy Agent Chat router | Bounded messages, role, catalog, authorized run and active decision refs → one `AgentDecision`. | Gemini primary/OpenAI fallback structured output. One action maximum; deterministic server tools re-authorize before access/mutation. This is the default turn path. [Chat](../src/backend/packages/agents/src/chat/legacy/orchestrator.ts), [tools](../src/backend/packages/agents/src/chat/operations.ts) |
| Agent Runtime | Untrusted workspace snapshot → authorized context → validated plan → canonical observations/actions → grounded response. | Feature-gated. A provider can select registered capabilities and supplied IDs only; registry, renderer and repository own authorization, values, references and mutations. [Runtime](../src/backend/packages/agents/src/runtime/runtime.ts), [context](../src/backend/packages/agents/src/runtime/context/builder.ts), [registry](../src/backend/packages/agents/src/runtime/capabilities/registry.ts) |

Successful `agent-v1` stages persist typed reference-only assistant stage messages and immutable artifacts. Recovery rehydrates those artifacts, verifies hashes/contracts/lineage, and checks task state instead of relying on worker memory. Agent Runtime turns persist only the existing user/assistant messages and typed references; their plans, prompts and observations are not retained. There is no unbounded multi-agent conversation loop.

## Deterministic vs LLM Responsibilities

| Concern | Owner in current code |
| --- | --- |
| As-of selection, metric arithmetic, aggregation, peer cohort, null/abstain, candidate rules | Deterministic @vda/semantic and domain code. decimal.js precision is 50; money/ratio arithmetic uses half-up rounding. |
| Chart values/specification and data bindings | Deterministic chart builder from validated calculation/comparison artifacts; unsupported charts return typed unavailable reasons. |
| Decision brief, material changes, hotspots, priority entities, action candidates and drilldowns | Deterministic buildDecisionIntelligencePack plus registered use-case policy. These are policy-bounded candidates, not authoritative instructions. |
| Artifact identity/hash, schema, tenant and lineage checks, authorization and publication | Deterministic contracts, domain validators and repository. |
| Legacy Agent Chat intent/action choice | The default chat provider may select one enumerated structured action. Deterministic shortcuts handle scope/date/signal constraints and the server validates/re-authorizes the operation. |
| Agent Runtime plan and response selection | The flagged runtime provider may select registered capability/input IDs in a preflighted plan, then observation/action IDs for the response. It cannot author response prose, metrics, SQL, scopes, references or workspace actions. The server renders/re-authorizes the selected canonical observations. |
| Narrative claim selection in run workflows | The narrative provider sees claim IDs and metric keys and returns a summary key plus claim IDs. It must return every supplied ID exactly once. Code restores canonical claims and fixed `SAFE_SUMMARY`; it does not accept model-authored numeric facts or prose claims. |

**Numeric truth is never assigned to the LLM.** Provider instructions prohibit calculating values, issuing SQL, inventing IDs/scopes/permissions/evidence or adding claims. Narrative and decision providers use structured JSON. Gemini requests time out after 30 seconds; OpenAI is configured with a 30-second timeout and one SDK retry; a provider fallback tries the next provider and returns a generic failure if all fail. No token limit is configured in the inspected calls.

## AI and Model Integration

There are separate provider boundaries:

- The [run narrative provider](../src/backend/packages/agents/src/legacy-workflow/narrative/provider.ts) and [default Agent Chat provider](../src/backend/packages/agents/src/chat/legacy/provider.ts) use the established Gemini primary/OpenAI fallback configuration and structured output. Gemini uses the `generateContent` REST endpoint; OpenAI uses the Responses API with structured Zod output and disabled storage on narrative requests.
- The [Agent Runtime provider factory](../src/backend/packages/agents/src/runtime/providers/factory.ts) serves the feature-gated Agent Runtime. Its default ordering is also Gemini then OpenAI; xAI is an optional adapter selected only by `AGENT_LLM_PRIMARY_PROVIDER` or `AGENT_LLM_FALLBACK_PROVIDER` with a configured server-only key/model. The runtime has its own 12-second default provider-attempt timeout, two-attempt stage limit, 45-second capped turn deadline, metadata-only provider telemetry, and a deterministic response fallback if composition cannot be safely completed.

The default Agent Chat context includes bounded recent messages, catalog, authorized runs and supported signal/decision metadata. The flagged runtime rehydrates and authorizes `WorkspaceContextV1` server-side before any provider call; its planner projection is capped at 24 KiB and at most 12 recent messages/five historical run IDs. Its composer receives observation/action IDs and metadata only, not provider-authored facts or raw snapshot rows. Both provider outputs are schema-parsed and checked against server-owned allowlists. There is no configured token budget. The normal Reviewer path uses a deterministic provider; it is not another LLM review call.

## End-to-End Data Flow

1. **Input and normalization:** CSV text is parsed by parseInventoryCsv; hierarchy and supported fields are validated before import. The run query reads snapshot rows through SqlRepository under tenant/scope/date constraints. [Domain parser](../src/backend/packages/domain/src/index.ts), [repository](../src/backend/packages/db/src/repository.ts)
2. **Snapshot selection:** for each unit, select the latest row with snapshot_date <= data_as_of, then apply project/zone scope. Period windows use the latest row at or before the target date (7/30/90 days), not necessarily a row on that exact day. The run pins selected snapshot membership at enqueue.
3. **Canonical metrics:** @vda/semantic calculates inventory, availability, snapshot-reported sales counts, movement, aging, price distribution and data-quality metrics. Rates are 0–100. Unavailable values stay null with a reason; they are not zero-filled.
4. **Comparison and signals:** deterministic peer/period/segment comparisons feed notable-change and insight candidates. Peer cohorts are not silently widened. Evidence paths bind claims to canonical values.
5. **Visualization:** ChartBuilder produces validated ChartSpec/visual-evidence from calculation and comparison artifacts. Every numeric datum is bound to an artifact path, or represented as unavailable.
6. **Decision and report:** the opt-in workflow derives decision brief v2, visual story, priority entities, bounded action candidates, drilldowns and completeness handoff; creates a draft; reviews it; and publishes only after PASS. The legacy workflow creates a report after its validation stage.
7. **Presentation/export:** UI hydrates canonical artifacts and renders charts/tables/evidence. JSON/CSV export is stored privately and downloaded through a short-lived BFF grant.

Metric definitions and limits: [semantic registry](../src/backend/packages/semantic/src/metrics/registry.ts), [semantic engine](../src/backend/packages/semantic/src/index.ts), and the contract declarations below.

## Artifact Model

An artifact is an immutable, run-scoped record with a stable logical key and schema-validated payload. ArtifactSchema defines its base metadata; **there is no artifact status field**. Run/task statuses describe lifecycle, and validation results are separate ArtifactValidation records.

Base fields include artifact_id, org_id, run_id, task_id, kind, schema_version (1.1), semantic_version, provisional, data_as_of, input_refs, snapshot_refs, source_refs, limitations, typed payload and content_hash. IDs derive deterministically from the run and logical key. The database enforces tenant/run/key uniqueness; artifacts and lineage rows are immutable. Agent-v1 uses keys such as data.calculation, comparison_pack, chart.visual_evidence, report_draft:1 and review_result:1/:2.

Important artifact families:

- **Inputs and computation:** analysis_request, coordinator_decision, query, query_result, calculation, comparison_calculation, comparison.
- **Stage packs:** data_analysis_pack, comparison_pack, chart_pack, analysis_pack, insight_pack, decision_intelligence_pack.
- **Evidence and presentation:** visual_evidence, legacy chart/insight artifacts, report_draft, review_result, published report.
- **Validity records:** schema/hash/tenant/lineage/deterministic-data checks are stored separately, not as artifact lifecycle status.

artifact_inputs, artifact_snapshots and artifact_sources retain parent artifacts, snapshot IDs and import/source IDs. Stable IDs, content hashes and schemas are rechecked when recovery loads a checkpoint. Draft/review artifacts are private to owners/analysts; viewers receive published report artifacts and permitted lineage.

Definitions and persistence: [contract schemas](../src/backend/packages/contracts/src/index.ts), [domain integrity](../src/backend/packages/domain/src/artifacts/integrity.ts), [agent artifact store](../src/backend/packages/agents/src/analysis-v1/checkpoint/artifact-store.ts), [DB types](../src/backend/packages/db/src/types.ts), [agent workflow SQL](../src/backend/supabase/schemas/006_agent_workflow_persistence.sql).

## Evidence, Provenance and Numeric Truth

bindClaims binds each candidate claim to a verified calculation or period-comparison path. It checks that the claim's metric key matches the evidence path and that the value there equals the canonical value. Decision-intelligence and report validators rebuild expected output or traverse referenced paths; invented, missing, duplicate or mismatched references fail validation.

The run records pinned snapshot membership. Artifacts carry input_refs, snapshot_refs, source_refs, limitations and hashes; companion lineage tables persist these relations. Charts bind points to canonical artifact paths. A report references validated calculation/comparison/visual/insight/decision artifacts. The final public report omits private draft/review artifact identifiers; publication checks the exact persisted draft/review pair and review PASS in a fenced transaction.

No validator can make synthetic data or provisional thresholds authoritative. Metric policy remains provisional.

## Data Contracts and Schemas

The TypeScript Zod definitions in [contracts/src/index.ts](../src/backend/packages/contracts/src/index.ts) are the runtime contract source. pnpm contracts:export emits JSON schemas under packages/contracts/schema/.

| Contract | Purpose / producer → consumer | Validation |
| --- | --- | --- |
| AnalysisRequestSchema, ImportRequestSchema, SnapshotRowSchema | API/import boundary → repository and worker | Zod parse, hierarchy/CSV validation, pinned scope checks. |
| RunSchema, task/event/conversation/message schemas | Repository → API/UI and worker | Zod parsing at API boundaries; state and idempotency constraints in repository/SQL. |
| ArtifactSchema and per-kind payload schemas | Workflow stage → repository, downstream stages, UI | Zod parse, stable hash, tenant/lineage checks, kind-specific deterministic validator. |
| MetricSchema, CalculationPayloadSchema, comparison schemas | Semantic calculation → insight/chart/report stages | Semantic registry, decimal arithmetic, null/abstention reasons, cross-artifact checks. |
| ChartSpecSchema (chart-spec-v1) and visual evidence | Chart builder → API/UI | chart-rules-v0.2; deterministic origin and evidence binding per numeric datum. |
| DecisionBrief v1/v2 and DecisionIntelligencePackSchema | Decision builder → report/API/UI/chat context | Rebuild-and-compare deterministic validator; all evidence references resolved. |
| AgentDecisionSchema, legacy typed tool inputs | Default Agent Chat provider → one server-validated operation | Structured provider schema plus allowed run/signal/scope checks and authorization. |
| WorkspaceContextV1, AgentPlanV1, capability schemas | Browser navigation hint / runtime planner → authorized context and registry | The BFF checks tenant/conversation/scope/date coherence; whole-plan preflight parses all inputs before side effects. |
| CanonicalAgentObservationV1, CapabilityResultV1, GroundedResponseSelectionV1 | Runtime capability → ID-only provider composition → persisted response | Server-owned observations/actions, reference reauthorization and deterministic rendering reject forged IDs, free prose and cross-run grounding. |
| AgentActivityEventV1, AgentTurnStreamEventV1 | Runtime activity → optional SSE client presentation | Closed metadata schemas, ordered sequence and normalized terminal result; SSE is not the correctness path. |
| ReportDefinitionSchema, report/export responses | Scheduling/report API → repository/UI | Zod contract, schedule validation, report publication/export checks. |

Generated JSON schemas cover analysis requests, runs, artifacts, report drafts, review results, decision packs, chart/comparison/insight packs and related contracts in [contracts/schema](../src/backend/packages/contracts/schema/). SQL schema is defined separately in ordered declarative files under [supabase/schemas](../src/backend/supabase/schemas/).

## Frontend Architecture

The web app has one AppShell and App Router pages for workspace, chat, runs, reports, imports and automations. `Workspace` composes the routed surfaces and session bootstrap. Feature hooks own catalog, run polling, report, evidence, conversation, message and turn state. `AgentChat`, `AnalysisResult`, `DecisionIntelligence`, `Evidence` and `ChartRenderer` own focused UI responsibilities. When `GROK_WORKSPACE_ENABLED=true`, the analysis surface renders `GrokWorkspace`: a dashboard surface plus Agent Chat and a context/evidence side panel. This layout does not itself enable the Agent Runtime.

The client calls same-origin `/api/v1` through feature APIs and `lib/http/api-client.ts`, uses same-origin credentials and no-store caching, and parses responses with Zod. It does not connect to PostgreSQL or Supabase Storage directly. React hooks hold view state; no shared query-cache/state library is present. `features/workspace/context.ts` derives a versioned turn snapshot from identifier-only UI selections, but the server remains authoritative. Run/workflow progress is polled; visible run polling is about 1.1 seconds and chat reduces polling frequency while hidden. When both runtime/SSE flags are enabled, `lib/sse.ts` consumes a short-lived POST-over-fetch activity stream and falls back to JSON for disabled/unsupported streaming.

The result UI prefers decision-intelligence output, then a decision brief, then legacy artifact hierarchy for older runs. Chart rendering uses Recharts. Evidence opens a native dialog with artifact IDs/hash, validation and lineage. Loading/error states use app boundaries plus panel-level busy/error states. Role-based disabled controls are a convenience; server authorization is authoritative.

References: [workspace shell](../src/frontend/src/features/workspace/workspace.tsx), [Agent Chat UI](../src/frontend/src/features/agent-chat/agent-chat.tsx), [analysis result](../src/frontend/src/features/analysis/components/analysis-result.tsx), [decision-intelligence UI](../src/frontend/src/components/decision-intelligence.tsx), [evidence UI](../src/frontend/src/features/evidence/components/evidence.tsx), [chart renderer](../src/frontend/src/components/visualization/chart-renderer.tsx), [client API](../src/frontend/src/lib/http/api-client.ts), [global styles](../src/frontend/src/app/globals.css).

## Reporting and Visualization

Data meaning is canonical in semantic metrics/evidence; ChartSpec is a typed visual encoding; report content is a typed report/draft payload; Recharts and report CSS are presentation. The LLM does not supply numeric chart series. Chart types include KPI, bar, line, pie, donut and scatter, with explicit unavailable reasons where inputs or policy do not support a chart.

Legacy runs build/validate a report in their DAG. Agent-v1 builds a private report draft, validates it with the reviewer workflow, then writes the public report. The report UI previews stored report/artifact data and supports JSON/CSV exports plus browser print styling. There is no dedicated server-side PDF/image renderer, external email delivery, or publication approval UI.

References: [chart builder](../src/backend/packages/agents/src/analysis/chart-builder.ts), [chart agent](../src/backend/packages/agents/src/analysis-v1/agents/chart-agent.ts), [report agent](../src/backend/packages/agents/src/analysis-v1/agents/report-agent.ts), [publication stage](../src/backend/packages/agents/src/analysis-v1/stages/publication.ts), [resource panels](../src/frontend/src/features/imports/components/imports-panel.tsx).

## Backend Architecture

The Next.js API catch-all exposes a same-origin BFF. server/api.ts handles route dispatch, principal resolution, body limits, schema validation, response schemas and problem responses. The API depends on @vda/db for authorized persistence and @vda/agents for decision/tool/workflow operations; workers invoke agents and repository interfaces directly. The database package uses parameterized PostgreSQL queries rather than an ORM. PostgreSQL queue/run records hand work from API to worker; there is no API-to-worker RPC.

Important route groups under /api/v1:

| Group | Routes |
| --- | --- |
| Setup/auth | GET /setup, GET /session, POST /auth/login, /auth/development-role, /auth/logout |
| Catalog/imports | GET /catalog, GET/POST /imports |
| Analysis/runs | POST /analyses, GET /runs, GET /runs/:id, /artifacts, /workflow-status, /brief, /decision-intelligence, POST /runs/:id/cancel |
| Conversations | GET/POST `/conversations`, conversation detail/messages, legacy GET `/messages`, optional POST `/conversations/stream` and `/conversations/:id/messages/stream` |
| Reports | GET /reports, report detail, POST /reports/:id/exports, GET /reports/:id/download |
| Schedules | GET/POST /report-definitions, PATCH/DELETE /report-definitions/:id, trigger and scheduler tick |

Run creation and conversation turns use `Idempotency-Key`; create endpoints return accepted work for the worker. The API chooses the default `AgentChatOrchestrator` or the feature-gated `AgentRuntime` at the BFF boundary. Streaming endpoints are rejected unless the runtime and SSE flags are enabled and the client explicitly accepts `text/event-stream`. Request bodies are capped at 2,100,000 bytes, mutation origin is checked when `Origin` is supplied, inputs and typed responses are schema-parsed, and internal 500 details are hidden. See [server API](../src/frontend/src/server/api.ts), [route](../src/frontend/src/app/api/v1/%5B...path%5D/route.ts).

## Persistence and Storage

@vda/db uses postgres with a small connection pool and raw parameterized SQL; no ORM, Redis cache or external queue is configured. Supabase PostgreSQL stores organizations/memberships, imports/snapshots, conversations/messages, runs and pinned snapshots, tasks/events, artifacts and lineage/validation, report definitions/occurrences, reports and export records. Payloads use JSONB alongside relational tenant/scope/key columns. IDs, uniqueness and foreign keys are tenant-scoped; immutable triggers protect important input and artifact records.

Core table names include organizations, organization_members, imports, snapshots, conversations, messages, runs, run_snapshots, tasks, artifacts, artifact_inputs, artifact_snapshots, artifact_sources, validations, events, definitions, occurrences, reports and report_exports.

Declarative schemas are [001_inventory.sql](../src/backend/supabase/schemas/001_inventory.sql) through [007_agent_stage_messages.sql](../src/backend/supabase/schemas/007_agent_stage_messages.sql); additive migrations are in [supabase/migrations](../src/backend/supabase/migrations/). The latest schema includes chat, durable workflow artifact keys/visibility and per-stage assistant messages. supabase/seed.sql seeds local synthetic data and local test users.

Supabase Storage has private source-import and report-export objects. Imports upload the original CSV before inserting the database manifest/snapshots; a database failure after upload can leave an orphan object because no compensating delete was found in that path. Exports store a content-hash-based object and ledger record, then return a five-minute signed BFF grant. No separate filesystem/object-storage abstraction or application cache was found.

## Agent Routing and Orchestration

The worker writes/claims tasks in PostgreSQL and owns a 30-second run lease renewed every 10 seconds. FOR UPDATE SKIP LOCKED lets workers claim work; an incremented fencing token prevents an expired worker from committing stale task/artifact/run state. Run attempt count is bounded at three. Schedules are persisted; the worker calls tick() about once per minute and creates idempotent occurrences/runs for due definitions.

The agent-v1 graph is sequential through Coordinator/Data, then fans out Comparison/Chart/Analyst branches, fans in at Insight, and continues through Report draft, Reviewer and Publication. Branch and draft/review stages resume from keyed immutable checkpoints. Review permits one correction/revision; a second non-PASS is terminal. `legacy-v1` is a separate executor.

The default Agent Chat is not a run orchestrator: it chooses at most one typed action and hands analysis to the existing run queue. The flagged Agent Runtime is also not a workflow engine: it uses a single bounded plan, then sequentially executes at most three registered capabilities against existing repository/data-plane methods. `create_analysis` is the only mutation, must be the sole plan step, and returns immediately once it queues a run. `getAgentTargetFollowUp` supplies deterministic checkpoint follow-ups for the legacy router and the runtime's `inspect_agent_checkpoint`; there is no arbitrary `@Agent` dispatch, parallel tool fan-out or planner loop.

## Failure Handling and Recovery

- Invalid bodies/contracts fail before repository mutation; route errors map schema and known validation issues to client problem responses and hide unexpected internals.
- Import parsing, hierarchy, duplicate unit/date and schedule validation errors are rejected; source manifests and snapshots are not updated in place.
- Established narrative/default-chat provider requests use structured output and the configured Gemini→OpenAI fallback. Agent Runtime provider work uses its own bounded attempt/turn deadlines and two-provider limit. A planner failure returns a stable generic failure; a composition failure falls back to deterministic rendering rather than a free-prose path.
- Worker failures mark the run failed with a sanitized code. A failed run can be retried in repository logic only below the attempt bound, but no retry API route is exposed.
- Lease expiry allows another worker to reclaim work. Stable keys and immutable checkpoints are reloaded and revalidated. Fencing prevents stale writes after lease loss or cancellation.
- Cancellation sets a terminal run state and fences current work. Agent-v1 publication failure, invalid evidence/artifacts, reviewer non-PASS at the revision limit, or lost lease cannot produce a published report.
- The optional SSE response is presentation-only. It streams schema-limited activity metadata and a normalized terminal result; a client may fall back to the JSON turn endpoint when streaming is disabled or unavailable.
- Storage and database are separate systems; failed DB persistence after an import object upload can leave an orphan source object (no compensating cleanup observed).

## Data Quality and Current Semantic Limits

Semantic version is mvp-inventory-v0.2; artifact schema is 1.1; chart contract is chart-spec-v1 with rules chart-rules-v0.2. Supported metric families include inventory/availability, snapshot-reported sales counts (7/30/90 days), movement, aging/slow-moving, price distribution, missing-value rates, invalid/unusable rows and snapshot coverage.

Slow-moving threshold defaults to 90 days and can be configured. Peer matching requires same organization/project/zone/unit type/bedrooms/currency, area within ±15%, excludes the target, and requires at least three peers. Multiple currencies, missing denominators, unsupported cohort coverage or missing historical snapshots can produce abstentions; null means unavailable, not zero. No silent cohort widening occurs.

The snapshot-based engine does not establish authoritative transaction sales velocity, reservation conversion/cancellation, price-change event analytics, freshness SLA/stale rate without an approved cadence, portfolio-wide project comparisons, or causal explanations. Supplemental mock warehouse facts do not imply the semantic pipeline consumes them. Data-quality metrics and limitations are included in artifacts/decision output, but no separate human publication gate based on a quality score was found.

## Security

- Supabase Auth is the identity provider. principal() resolves the authenticated user; workspace membership and role are checked server-side. Roles are owner, analyst, viewer; viewer is read-only. Development role grants are signed, HttpOnly, SameSite-strict, expire after eight hours and are rejected in production.
- Repository operations use organization-scoped checks; reads apply authenticated role/JWT context so RLS executes. Declarative SQL enables tenant RLS, revokes direct authenticated writes and grants needed reads. Private draft/review artifacts and companion lineage are restricted to owner/analyst.
- Database URLs, Supabase secret, and LLM keys are server/worker-only. Config rejects unsafe NEXT_PUBLIC_* secret names. API mutation origin checks, body limits, Zod validation, no-store headers and generic internal errors are implemented.
- SQL values are parameterized; dynamic table access uses a literal allowlist. Storage buckets are private; report downloads require a short-lived signed grant and membership revalidation.
- Legacy tools and runtime capabilities operate on bounded typed inputs and re-authorize immediately before use. Model providers cannot choose raw SQL, permission, arbitrary scope/IDs, unregistered capabilities or unrestricted tool loops. Runtime composition also cannot emit free prose or create workspace actions; it selects server-issued IDs that the renderer rechecks. No dedicated prompt-injection scanning subsystem was found; current boundaries are bounded context, structured schemas, fixed tool allowlists and server authorization.

Security implementation: [request context](../src/frontend/src/server/context.ts), [repository](../src/backend/packages/db/src/repository.ts), [storage](../src/backend/packages/db/src/storage.ts), [tenant RLS test](../src/backend/supabase/tests/tenant_rls.test.sql), [security check](../src/backend/scripts/check-security.ts).

## Logging and Observability

The worker writes structured JSON console events for connection failure, worker failure, run start/failure and scheduler tick, with safe IDs/codes rather than provider secrets. Agent Runtime writes metadata-only provider-attempt telemetry and may emit closed activity events (`context`, `tool`, `run`, `answer` and safe-error states) to its optional SSE response; prompts, plans, observations, evidence and raw provider output are excluded. Run events and task states are stored in PostgreSQL and shown in the UI. There is no Sentry, OpenTelemetry exporter, metrics backend or distributed tracing dependency/configuration in the repository. Provider errors normalize to stable codes; API 500 responses do not expose raw internals.

## Testing

| Type | Present evidence |
| --- | --- |
| Unit/domain/contract | Vitest suites for semantic calculations, chart building, legacy/agent-v1 workflows, runtime context/planning/limits/registry/composition, provider fallback, integrity and repository behavior. |
| Integration | Pipeline tests using PGlite and embedded PostgreSQL helpers, stored alongside unit suites. |
| Frontend/server components | Tests for Agent Chat, Grok workspace/dashboard/context reducer, AnalysisResult, chart rendering, SSE parser and server stream. |
| Browser E2E | Playwright local-Supabase MVP flow covers legacy Agent Chat through the API plus role-scoped analysis/evidence/report UI. The opt-in `agent-v1` test is API-focused; no browser E2E covers the feature-gated Agent Runtime against a live provider. |
| Database/RLS | Supabase pgTAP SQL tests for tenant RLS; repository/schema tests also run against PGlite. |
| CI | GitHub Actions runs format, lint, typecheck, Vitest, security/docs checks, build, Playwright and a separate local Supabase DB test job. |

Commands are defined in [package.json](../package.json), [Vitest config](../src/backend/tests/vitest.config.ts), [Playwright config](../src/backend/tests/playwright.config.ts) and [CI workflow](../.github/workflows/ci.yml): pnpm test, pnpm test:e2e, pnpm test:db, pnpm typecheck, pnpm lint, pnpm format:check, pnpm build, pnpm check:security, pnpm check:docs.

Tests exercise semantic invariants, chart provenance, workflow recovery/publication, runtime authorization/preflight/budgets/grounded rendering, provider fallback, repository/pipeline behavior, RLS, SSE safety and selected UI states. No coverage percentage/report is checked in. The current browser suite does not exercise the feature-gated Agent Runtime with an external provider.

## Local Development

Prerequisites in README: Node.js 24+, pnpm 11.0.8, Supabase CLI and Docker Desktop or compatible container runtime. Create .env from .env.example; configuration requires Supabase URL/publishable key, server secret, PostgreSQL connection URL, Gemini API key/model and OpenAI fallback key/model. Do not copy secrets into browser code or context documentation.

~~~sh
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:reset
pnpm dev
~~~

`pnpm dev` starts web and worker through Turbo. Separate commands include `pnpm dev:web`, `pnpm dev:worker`, `pnpm scheduler:tick`, `pnpm db:start`, `pnpm db:reset`, and `pnpm test:db`. The default `.env.example` keeps `AGENT_WORKFLOW_ENABLED`, `GROK_RUNTIME_ENABLED`, `GROK_WORKSPACE_ENABLED` and `GROK_SSE_ENABLED` off. Mock warehouse scripts use `WAREHOUSE_DB_URL` and curated source input; they do not fall back to `SUPABASE_DB_URL`. See [mock-data README](../scripts/mock-data/README.md).

There is no root production-start command. Package-level entrypoints are pnpm --filter @vda/web start for Next and pnpm --filter @vda/worker start for the worker after build/configuration.

## Build and Deployment

Turbo builds the workspace dependency graph; Next uses src/frontend/next-with-env.mjs to load root .env; the worker has independent dev, start, once and scheduler-tick scripts. Supabase CLI uses PostgreSQL major version 17 locally and applies ordered declarative schemas/seeds. GitHub Actions has offline app/Playwright and local-Supabase database jobs.

No Dockerfile, app-hosting manifest, remote deployment target, migration release workflow or CD configuration was found. Production topology, secret injection, worker scaling and schedule hosting are **Unknown from current codebase**. README describes local Supabase as the tested path and says remote deployment is outside the MVP.

## Dependencies and Technology Stack

| Layer | Technology | Role in current architecture | Where used |
| --- | --- | --- | --- |
| Language/workspace | TypeScript, Node.js, pnpm, Turborepo | Shared typed packages and coordinated build/dev tasks | Root/package manifests |
| Web/API | Next.js, React | Workspace UI plus same-origin server API/BFF | src/frontend |
| Styling/icons/charts | Tailwind CSS 4, authored CSS, Lucide React, Recharts | UI styling/icons and rendering validated chart specs | globals.css, UI components |
| Contracts/validation | Zod 4 | Runtime request, response, workflow, artifact and provider-output validation | packages/contracts, API, agents |
| Database | Supabase PostgreSQL, postgres | Tenant data, artifacts, run/task queue, conversations and schedules; parameterized raw SQL | packages/db, supabase |
| Identity/storage | Supabase Auth, @supabase/ssr, @supabase/supabase-js, Supabase Storage | Session/cookie integration and private source/export objects | frontend server, db storage |
| Semantic arithmetic | decimal.js | Decimal arithmetic for monetary and ratio metrics | packages/semantic |
| Model integration | Gemini REST API, OpenAI SDK/Responses API, optional xAI Responses-compatible fetch adapter | Structured legacy decisions/narrative selection and, behind a flag, runtime plan/ID selection with fallback | packages/agents/src/provider.ts, runtime-provider.ts, xai-provider.ts |
| Tests | Vitest, Playwright, PGlite, Supabase pgTAP | Unit/component/integration, browser and database/RLS checks | root and src/backend/tests |
| Build/style checks | Turbo, TypeScript, ESLint 9, Prettier 3 | Build graph, type checks, lint and formatting | root config |
| Deployment/monitoring | No app deployment or monitoring integration configured | Hosted runtime/observability topology is not defined in repo | CI is test/build only |

## Repository Map

~~~text
.
├── docs/                         Product contracts, plans, mapping and this context
├── scripts/mock-data/            Curated warehouse validation/import tooling
├── src/frontend/src/
│   ├── app/                      Root page, error/loading, API catch-all
│   ├── components/               Workspace, chat, results, evidence, charts, resource panels
│   ├── lib/                      Client API and chart formatting
│   └── server/                   API dispatch and request principal
└── src/backend/
    ├── packages/{agents,config,contracts,db,domain,semantic}/
    ├── worker/src/                Queue worker and scheduler tick
    ├── supabase/{schemas,migrations,tests}/ Declarative SQL, migrations, RLS tests and seed
    ├── tests/{unit,e2e}/            Vitest/Playwright tests, helpers and fixtures
    └── scripts/                   Documentation/security checks and E2E harness
~~~

vda_vinhomes_mock holds synthetic warehouse source material/configuration; large raw/curated/quarantine directories are git-ignored. Generated .next, .turbo, node_modules, test outputs and local Supabase state are not architectural source.

## Important Files for a New Developer

| File | Why read it |
| --- | --- |
| [README.md](../README.md) | MVP boundary, local prerequisites and startup sequence. |
| [package.json](../package.json), [turbo.json](../turbo.json), [.env.example](../.env.example) | Workspace commands, task graph and required configuration names (no secret values). |
| [workspace.tsx](../src/frontend/src/features/workspace/workspace.tsx) | Routed workspace composition and session boundary. |
| [API router](../src/frontend/src/server/api/router.ts) | Resource routing behind the same catch-all BFF endpoint. |
| [contract index](../src/backend/packages/contracts/src/index.ts) | Canonical TypeScript data contracts and versions. |
| [semantic index](../src/backend/packages/semantic/src/index.ts) | Numeric and as-of truth boundary. |
| [repository](../src/backend/packages/db/src/repository.ts) | Persistence, authorization, queue, artifact, report and import behavior. |
| [legacy executor](../src/backend/packages/agents/src/legacy-workflow/workflow.ts), [agent-v1 executor](../src/backend/packages/agents/src/analysis-v1/workflow.ts) | Run workflow implementations. |
| [Agent Runtime](../src/backend/packages/agents/src/runtime/runtime.ts), [runtime context](../src/backend/packages/agents/src/runtime/context/builder.ts), [capability registry](../src/backend/packages/agents/src/runtime/capabilities/registry.ts) | Feature-gated chat authorization, bounded execution surface and grounded response boundary. |
| [worker main](../src/backend/worker/src/main.ts), [run loop](../src/backend/worker/src/run-loop.ts) | Worker lifecycle, lease dispatch and scheduler. |
| [initial schema](../src/backend/supabase/schemas/001_inventory.sql) through 007_agent_stage_messages.sql | Database/RLS contracts and schema evolution. |

## Architectural Invariants

1. A run pins organization/scope/as-of snapshot membership and workflow_version; later data arrivals or flag changes do not silently change its inputs or executor.
2. @vda/semantic and deterministic validators own numeric truth. Null/abstention is not zero; peer cohorts are not silently widened.
3. Claims, chart data, decision output and reports must resolve to canonical artifact evidence and lineage. Artifact hashes/contracts are checked at persistence/recovery boundaries.
4. Artifacts are immutable and run-scoped; validity and lifecycle belong to validation/task/run records, not an invented artifact status field.
5. A viewer cannot mutate; organization membership is checked server-side and tenant-scoped reads are also protected by RLS.
6. Only the fenced publication path may create a public agent-v1 report, requiring an exact persisted reviewer PASS.
7. LLM output is structured and bounded. It cannot create SQL, canonical numbers, evidence, permissions, arbitrary scopes or unrestricted tool loops; Agent Runtime composition selects only server-issued observation/action IDs and the server renders the response.
8. Browser code calls the same-origin BFF and must not access database/service secrets directly.

## Current Implementation Status

The Status column uses the labels Implemented, Partial, Scaffolded, Planned and Deprecated.

| Subsystem | Status | Evidence |
| --- | --- | --- |
| Next.js workspace, auth/session UI, scoped panels | Implemented | src/frontend/src/features/workspace/workspace.tsx; src/frontend/src/server/context.ts |
| CSV snapshot import and private source object | Implemented | src/backend/packages/db/src/repository.ts; src/backend/packages/db/src/storage.ts |
| Legacy inventory analytics/report DAG | Implemented | src/backend/packages/agents/src/legacy-workflow/workflow.ts; semantic/pipeline tests |
| Durable agent-v1 workflow and reviewer/publication gate | Implemented | Opt-in; AGENT_WORKFLOW_ENABLED=false; analysis-v1/workflow.ts and workflow tests |
| Legacy Agent Chat decision/tool workflow | Implemented | Bounded to one action per turn; chat/legacy/orchestrator.ts, chat/operations.ts and UI/tests |
| Feature-gated Agent Runtime, optional xAI adapter and closed capability registry | Implemented | `GROK_RUNTIME_ENABLED=false` by default; runtime/runtime.ts, runtime/providers/factory.ts, runtime/providers/xai-provider.ts and runtime/capabilities/registry.ts |
| Optional Grok-named workspace, context/evidence panel and dashboard bridge | Implemented | `GROK_WORKSPACE_ENABLED=false` by default; features/grok-workspace/components/grok-workspace.tsx, features/workspace/context.ts and features/grok-workspace/components/grok-dashboard-surface.tsx |
| Safe Agent Runtime SSE | Implemented | Requires `GROK_RUNTIME_ENABLED` and `GROK_SSE_ENABLED`; POST-over-fetch activity/final events keep JSON and polling fallbacks |
| Deterministic decision-intelligence pack and UI | Implemented | domain/src/decision-intelligence/build-pack.ts; decision-intelligence API; frontend renderer |
| Reports, JSON/CSV exports and scheduler | Implemented | Repository/API/report panels and worker tick |
| Bulk mock warehouse import tooling | Implemented | Separate scripts under scripts/mock-data/ |
| Remote application deployment/CD | Planned | README places remote deployment outside MVP; no hosting/release configuration found |

## Technical Debt and Known Risks

- **README has one unchecked broken link.** `README.md` links to `docs/LOCAL_CONFIGURATION.md`, which is not in the repository. `pnpm check:docs` currently passes because it validates Markdown files beneath `docs/`, not the root README; its three required MVP handoff documents are present.
- **Agent-v1 is not the default run path.** It is implemented and has workflow/API tests, but `.env.example` sets `AGENT_WORKFLOW_ENABLED=false`. The optional agent-v1 E2E case is API-focused; it does not substitute for a full browser Chat UI regression.
- **Feature-flag rollout needs live-environment verification.** Agent Runtime, optional xAI adapter, Grok-named layout and safe SSE default off. A configured xAI credential/ZDR response, external provider behavior and deployed SSE proxy behavior have not been verified from this repository.
- **Retry asymmetry:** repository logic exposes retryRun, but there is no API route/UI entry point for it. Chat retry concerns the same turn/idempotency identity, not arbitrary failed-run retry.
- **Storage/DB compensation:** source upload precedes import DB commit; no cleanup compensates for an object left behind after DB failure.
- **Analytics remain snapshot-based and provisional:** additional transaction/reservation/price-history warehouse facts do not mean current metric definitions consume those event tables. Do not infer authoritative sales/freshness or causal metrics.
- **Operational production setup:** no deploy target, worker scaling strategy, production schedule host or production secrets manifest is checked in.
- A repository search found no active source TODO/FIXME/HACK/XXX markers in `src` or the existing docs other than this context document; the documented risks above are supported by configuration, workflow boundaries or checked-in documentation.

## Open Questions

- Which hosted production topology, migration/release process, worker count and scheduler trigger will be used? **Unknown from current codebase.**
- When should AGENT_WORKFLOW_ENABLED be enabled by default, and what rollout/rollback policy is intended? Its default-off value is explicit; future rollout criteria are not in implementation.
- Who provisions organizations and memberships outside local seed data? No membership-administration UI/API was found.
- Which inventory assumptions and policy thresholds have business approval? Code and README label current values provisional; approval evidence is not in the repository.

## Discrepancies Between Existing Documentation and Implementation

- The previous context snapshot (2026-09-21) described only the legacy run DAG. Current source also contains durable agent-v1 stages, parallel branches, persisted draft/review artifacts, a bounded revision and a fenced publication gate (default disabled).
- The old Agent Chat summary omitted inspect_signal and active decision-intelligence context/message references supported by current contracts and tools.
- The current contract includes decision-brief v2/decision-intelligence packs, typed action candidates, priority entities and drilldowns; these are deterministic policy outputs, not LLM recommendations.
- Declarative SQL/migrations extend through 007_agent_stage_messages.sql; older context listed only initial inventory/chat schema.
- The three handoff/traceability documents required by `check-docs.ts` are present and the command passes. The root README's `LOCAL_CONFIGURATION.md` link remains unresolved because the checker does not scan it.
- Target architecture and agent-chat plans are design/rollout documents. Source code and tests are the evidence for implemented portions of the feature-gated Agent Runtime, optional xAI adapter, workspace and SSE path.

## Documented but Not Found in Current Implementation

The target architecture and product-planning documents still describe capabilities beyond verified runtime. In particular, docs/VDaAgent_TARGET_AGENT_ARCHITECTURE_AND_SOL_REVIEW_PROMPT.md and docs/agents/agent-chat-implementation-plan.md are design/review documents, not runtime configuration. The feature-gated Agent Runtime includes Gemini/OpenAI selection, optional xAI, a closed capability registry, server-rendered grounded responses, the optional Grok workspace and safe SSE activity/final events. Server-side PDF/image rendering, external report delivery and Redis/Kafka/BullMQ runtime services are still not implemented.

Related planning/reference docs: [agent-chat implementation plan](agents/agent-chat-implementation-plan.md), [target architecture review prompt](VDaAgent_TARGET_AGENT_ARCHITECTURE_AND_SOL_REVIEW_PROMPT.md), [decision-intelligence product contract](decision_intelligence_product_contract.md), [implementation plan](implementation_plan.md), [mock-data mapping](data/mock-data-supabase-mapping.md).

## Glossary

| Term | Meaning in this codebase |
| --- | --- |
| Workspace | Organization-scoped UI/catalog context with owner, analyst and viewer roles. |
| Run | Idempotent analysis execution record with immutable request, pinned snapshots and workflow version. |
| Task | A run stage with status/error checkpoint; agent-v1 branches are separately persisted tasks. |
| Artifact | Immutable typed output identified by organization/run/key, with schema/hash and lineage; no lifecycle status field. |
| Evidence | A path/reference into validated artifacts supporting a claim or chart datum. |
| Metric | Versioned deterministic value or explicit unavailable/abstention result. |
| Decision brief | Decision-oriented summary backed by canonical metrics and evidence. |
| Decision-intelligence pack | Typed package containing brief, story, priority entities, bounded actions, drilldowns and completeness information. |
| ChartSpec | Versioned chart encoding of validated numeric data with provenance bindings. |
| Report draft | Private, revisioned candidate report in agent-v1 before reviewer PASS. |
| Published report | Canonical report artifact/record available through authorized report APIs. |
| Agent | A typed deterministic workflow stage, bounded legacy Chat router, or feature-gated runtime control plane; not necessarily an autonomous LLM. |

## Context Maintenance Guide

Update this file when architecture, agent/stage responsibility, major workflows, artifact/schema or API contracts, persistence, security, technology, deployment, or major frontend/report behavior changes. Do not update it for small CSS/copy edits, local bug fixes that do not alter architectural behavior, or internal refactors preserving contracts and behavior.

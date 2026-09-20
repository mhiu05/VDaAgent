# VDaAgent Agent Chat Architecture Review and Implementation Plan

> **PRIMARY IMPLEMENTATION SPECIFICATION FOR GPT-5.6 TERRA**
>
> Status: design only. This document does not implement Agent Chat. It is based on the working tree inspected on 2026-09-20; the current TypeScript/pnpm monorepo is the source of truth, including its uncommitted migration away from the former Python application.

## Part I — Architecture Review

## 1. Executive Summary

VDaAgent already contains almost every expensive foundation needed for an analytics Agent Chat: authenticated workspaces, deterministic semantic calculations, an idempotent PostgreSQL run queue, a leased worker, a fixed analysis DAG, immutable evidence-linked artifacts, report publication gates, polling, cancellation, and basic conversation/message persistence. The correct design is to extend these systems, not create a second chat runtime or analytics engine.

The recommended MVP is one bounded, provider-agnostic orchestrator with a small typed tool registry. It interprets a user turn, validates the proposed action against server-owned workspace context, and either starts the existing analysis pipeline, references an already-authorized result, or returns an honest unsupported response. It may never execute arbitrary SQL, calculate metrics, create chart values, widen scope, or make evidence-free factual claims.

Conversation history remains workspace-shared, matching current organization membership and RLS semantics. Existing `conversations` and `messages` tables are extended. Ordered heterogeneous message parts live in the existing message `payload` JSONB, but only contain text and canonical references. Run, artifact, metric, chart, evidence, and report payloads remain canonical in their existing stores.

The UI becomes an Agent Chat experience inside the current `WorkspaceShell`. It reuses `AnalysisResult`, `ChartRenderer`, `EvidenceDrawer`, and the current task polling/cancellation flow. There is no new route tree, frontend application, queue, event bus, streaming service, vector store, Python service, or multi-agent coordinator.

## 2. Current Architecture

```text
Browser / WorkspaceShell (Next.js Client Component)
  |  same-origin /api/v1, no-store, Zod response parsing
  v
Next.js catch-all Route Handler -> src/frontend/src/server/api.ts
  |  principal() from Supabase Auth or explicit development grant
  |  Repository authorization (organization membership + role)
  v
SqlRepository (created by createRepository)
  |-- conversations/messages
  |-- runs/run_snapshots/tasks/events
  |-- artifacts/validations/reports
  `-- PostgreSQL queue rows with lease + fencing token
             |
             v
@vda/worker claimRun() -> executeLease()
             |
             v
orchestrator -> data -> calculation -> comparison -> chart
             -> insight -> validation -> report
             |
             +--> @vda/semantic owns business calculations
             +--> NarrativeProvider selects verified claim IDs only
             `--> canonical artifacts + lineage + validation + report
                         |
                         v
Browser polls run/tasks/events, then loads artifacts/messages and renders
```

Important boundaries observed in the code:

- `src/frontend/src/app/api/v1/[...path]/route.ts` is the HTTP entry point; `src/frontend/src/server/api.ts` is the BFF/router and validates all bodies and responses.
- `src/frontend/src/server/context.ts` derives the principal and constructs the repository. Client-supplied user or role data is not authoritative.
- `src/backend/packages/db/src/repository.ts` owns transactions, authorization, queue state, snapshot pinning, fencing, messages, artifacts, and reports.
- `src/backend/worker/src/index.ts` claims queued runs; `src/backend/packages/agents/src/index.ts` executes the eight-task DAG.
- `src/backend/packages/semantic/src/index.ts` and `registry.ts` own metric semantics. `src/backend/packages/domain/src/integrity.ts` and the artifact validators protect lineage and publication.
- The frontend polls approximately every 1,100 ms. It does not currently use SSE or WebSocket.

## 3. Existing Capabilities

| Capability | Existing implementation | File/evidence | Decision |
| --- | --- | --- | --- |
| Analysis submission | Typed `AnalysisRequestSchema`; `POST /analyses` | `contracts/src/index.ts`, `frontend/src/server/api.ts` | Reuse internals; preserve endpoint for compatibility |
| Run lifecycle | queued/running/succeeded/failed/cancelled, retry and idempotency | `db/src/repository.ts` | Reuse and attach to chat turns |
| Queue | PostgreSQL rows claimed with `FOR UPDATE SKIP LOCKED` | `db/src/repository.ts` | Reuse; no new queue |
| Worker | lease renewal, fencing and stale-write rejection | `worker/src/index.ts`, repository | Reuse unchanged except terminal message integration |
| DAG | eight typed tasks with dependencies | `agents/src/index.ts` | Reuse; it is the analysis executor, not a second agent |
| Semantic layer | versioned deterministic metrics, comparisons and abstention | `semantic/src/index.ts`, `semantic/src/registry.ts` | Remains sole business-calculation authority |
| Artifacts | typed metric/calculation/comparison/chart/insight/report artifacts | contracts, agents, repository | Reference, never duplicate in chat payloads |
| Chart | deterministic chart builder and current renderer | `agents/src/chart-builder.ts`, `frontend/src/components/chart-renderer.tsx` | Reuse |
| Evidence | source refs, snapshots, artifact inputs, lineage and drawer | domain/repository, `frontend/src/components/evidence.tsx` | Reuse |
| Reports | validated report artifact, report record and export | agents/repository/API | Reuse |
| Messages | user/assistant messages scoped by org/conversation/run | contracts, repository, `messages` table | Extend, do not replace |
| Conversations | existing table and `conversation_id` in requests | `001_inventory.sql`, repository | Extend with metadata/listing |
| LLM provider | Gemini primary, OpenAI fallback, structured output, 30 s timeout | `agents/src/provider.ts` | Extend provider-agnostically |
| Auth | Supabase Auth; HMAC development role grant only in development | `frontend/src/server/context.ts` | Reuse |
| Roles | owner/analyst write; viewer read-only | contracts/repository/tests | Preserve exactly |
| RLS | workspace membership SELECT; direct client writes revoked | `001_inventory.sql`, `tenant_rls.test.sql` | Preserve and extend tests |
| Frontend | one workspace shell with analysis/reports/schedules/imports/history | `frontend/src/components/workspace.tsx` | Integrate Agent Chat here |
| Polling | run/task/event polling at ~1.1 s | `workspace.tsx` | Reuse for MVP |
| Cancellation | one server cancellation path increments fencing token | repository and `/runs/:id/cancel` | Reuse; no second cancellation model |

## 4. Message / Conversation Foundation

The current foundation is usable but incomplete:

- `MessageSchema` supports `user` and `assistant`, plain text, `conversation_id`, nullable contract `run_id`, and `created_at`.
- The database currently makes `messages.run_id` non-null, so every persisted message is tied to an analysis run. This conflicts with honest unsupported/provider-error turns and must be relaxed.
- A user message is inserted when a run is enqueued. An assistant message is inserted only after a validated report succeeds. Failures and cancellations therefore do not persist a terminal assistant state.
- `conversations` stores only `org_id`, `id`, and `created_by`. There is no list API, title, timestamps, kind, or pagination.
- `messages()` loads the complete conversation, then sorts in application memory. There is no cursor or stable database-side pagination.
- Access is intentionally workspace-level: any current organization member can read the organization's conversations through repository authorization/RLS. It is not creator-private.

Decision: **REUSE / EXTEND** these tables and contracts. Add lifecycle metadata and typed JSONB parts; do not create parallel `conversation_messages`, `message_parts`, `agent_actions`, or `tool_calls` tables for MVP. Existing run/tasks/events are the durable execution audit trail. Chat stores the observable action receipt and canonical IDs, not hidden reasoning or copied analytics.

## 5. Agent / Provider Foundation

`NarrativeProvider.narrate(claims)` currently has deliberately narrow authority. Gemini and OpenAI must return all supplied claim IDs exactly once; the application supplies `SAFE_SUMMARY` and rejects unknown/missing IDs. Gemini uses JSON schema and temperature 0; OpenAI uses Responses structured parsing with `store: false`; both are bounded by timeouts and a fallback wrapper.

The existing provider abstraction does not perform tool selection and currently discards individual provider errors when falling back. Add a separate `AgentDecisionProvider` interface and structured decision schema rather than broadening `NarrativeProvider` into an untyped general chat client. Both Gemini and OpenAI implementations must receive the same bounded input and produce the same discriminated union. Preserve current configured provider order.

The current question is persisted but does not alter the fixed DAG or metric inventory. Agent Chat must state this limitation: the first MVP routes supported inventory questions into the complete deterministic inventory pipeline and focuses rendering on available canonical artifacts; it does not make the pipeline capable of arbitrary analytics.

## 6. Grok/xAI Reference Findings

Official references reviewed:

- [Grok Build sessions](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md): durable session identity, list/resume metadata, incrementally persisted updates, and bounded context/compaction.
- [Grok Build permissions and safety](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/22-permissions-and-safety.md): server/runtime authorization before tool execution, narrow rules, and deny precedence.
- [Grok Build commands/context](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/04-slash-commands.md): new/resume/cancel/context management as explicit user-visible session operations.
- [xAI Python SDK](https://github.com/xai-org/xai-sdk-python) and its [function-calling example](https://github.com/xai-org/xai-sdk-python/blob/main/examples/sync/function_calling.py): typed tool arguments, validation before execution, explicit tool-result correlation, and multi-turn append order.
- [Supabase declarative schemas](https://supabase.com/docs/guides/local-development/declarative-database-schemas), [API security](https://supabase.com/docs/guides/api/securing-your-api), and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): schema files are source of truth; grants and RLS are separate controls; generated migrations require review.

**Adopt**

- Durable conversation identity, list/resume, stable timestamps, and persisted observable states.
- Typed/validated tool requests and explicit typed results.
- Cancellation and progress as visible state, not prose pretending to be reasoning.
- Bounded context, explicit tool allowlist, and authorization immediately before execution.

**Adapt**

- Map a Grok session to an existing VDaAgent conversation.
- Map tool/task updates to relational messages plus existing runs/tasks/events.
- Use current Gemini/OpenAI adapters and Zod structured output instead of introducing xAI.
- Use polling and full validated results rather than token streaming.

**Ignore**

- Shell, filesystem editing, terminal, worktrees, rewind, coding permissions, plugins/MCP, subagents, and general autonomous loops.
- Grok's local JSONL/SQLite storage format; PostgreSQL/RLS already solves VDaAgent persistence and tenancy.
- Python/xAI runtime and server-side session state.

## 7. Architecture Mapping

| Grok concept | VDaAgent equivalent | Decision |
| --- | --- | --- |
| Session | `conversations` row | Extend metadata and listing |
| Conversation | ordered `messages` | Persist/paginate by conversation |
| Message | `MessageSchema` + `messages.payload` | Extend with status and typed parts |
| Runtime | bounded Agent Chat orchestrator | New thin layer in `@vda/agents` |
| Tool | server-side typed domain capability | Small explicit registry only |
| Tool result | canonical IDs/status/error | Store references; never copied facts |
| Task | existing `RunTask` | Reuse |
| Progress | run status, tasks and events | Reuse polling; map only real states |
| Cancellation | `cancelRun` + fencing | Reuse |
| Streaming | token/update stream | Do not adopt for MVP |
| Permission | repository authorization + RLS | Server-owned context; deny viewer writes |
| Context | catalog + recent messages + recent run refs | Bound by count/characters and allowlist |
| Persistence | PostgreSQL tables | Extend existing tables |
| Structured output | Zod/JSON schema provider response | Reuse pattern for decision union |

## 8. Recommended Agent Architecture

```text
Agent Chat UI
  | POST first/follow-up turn + idempotency key + explicit scope/date
  v
Conversation API (auth, origin, body and Zod validation)
  |-- persist user message + assistant placeholder
  |-- build bounded server-authoritative context
  v
Single Agent Orchestrator (one decision, no recursive autonomous loop)
  |-- create_analysis ----------> createRunForTurn()
  |                                  |
  |                                  v
  |                           existing PG queue/worker/DAG
  |-- get_analysis_result ----> authorized existing refs only
  `-- unsupported -----------> deterministic honest response

Worker terminal transaction
  -> update run/report
  -> finalize assistant placeholder with text + run/report/artifact refs
  -> touch conversation.updated_at

UI polling
  -> run/tasks/events while active
  -> canonical artifacts/report at success
  -> persisted message state survives reload
```

There is exactly one orchestrator decision per turn and at most one selected domain tool. `get_workspace_context` is a deterministic preflight capability, not a model-selected database exploration tool. This is deliberately not a generic ReAct loop.

## 9. Responsibility Boundaries

| Layer | Responsibility | Must not do |
| --- | --- | --- |
| Frontend | capture text/context, render persisted turns, poll, cancel, hydrate refs | calculate metrics, trust local role, invent progress or facts |
| API/BFF | authenticate, validate, rate/body/origin boundaries, map errors | expose secrets, accept model/client authority fields |
| Orchestrator | build bounded context, request one typed decision, dispatch allowed tool | run SQL, calculate metrics, loop autonomously, keep hidden CoT |
| LLM | understand language and choose a schema-valid action/focus | invent IDs, scope, metrics, chart data, claims or permissions |
| Tools | validate input, re-authorize, bridge to existing repository capability | access credentials or bypass repository |
| Semantic engine | compute business metrics/comparisons/null semantics | accept LLM-calculated replacements |
| Repository | transactions, persistence, idempotency, authorization, queue | trust client/model org/user/role |
| Worker | execute the fixed long-running DAG with lease/fencing | act as a second chat agent |
| Database/RLS | canonical records and workspace isolation | become a general model-query interface |

## 10. Conversation Data Model

Extend the existing tables; add no new entity table.

**Conversation**

- Existing: `org_id`, `id`, `created_by`.
- Add: `kind` (`interactive` or `scheduled`), deterministic `title`, `created_at`, `updated_at`.
- Title: normalized first user message, maximum 80 characters; fallback `New analysis`. Do not call an LLM just to title.
- Ordering: `(updated_at DESC, id DESC)` with an opaque keyset cursor.
- Visibility: shared with all current workspace members, preserving current behavior.

**Message**

- Keep `content` as plain-text/search/accessibility fallback.
- Add `status`: `submitted | in_progress | completed | failed | cancelled`.
- Add `parts`: ordered discriminated union of `text`, `run_ref`, `report_ref`, `artifact_ref`, and `error`.
- Add `client_turn_id` to correlate the user message and assistant placeholder and make retries safe.
- Make `run_id` nullable for unsupported/provider-error turns.
- Add relational `role`, `status`, `created_at`, and `updated_at` columns for constraints, ordering and pagination while retaining the complete validated payload JSONB.
- Enforce unique `(org_id, conversation_id, client_turn_id, role)` for non-null `client_turn_id`, and one message per role per non-null run.

Do not store metrics, chart series, evidence bodies, report bodies, prompts, provider secrets, or chain-of-thought in message parts. Hydrate reference parts via existing authorized endpoints.

## 11. Tool Model

| Tool | Input | Output | Permission | Reuses |
| --- | --- | --- | --- | --- |
| `get_workspace_context` | server `userId/orgId`, selected scope/date | role, catalog, allowed actions | any member; read-only | `authorize`, `catalog` |
| `create_analysis` | question, project/zone, `data_as_of`, turn IDs | accepted `run_id`, conversation/message refs | owner/analyst; mutating | snapshot validation, `createRun` internals, queue |
| `get_analysis_result` | a `run_id` present in bounded context, requested view | authorized run/report/artifact reference set | any member; read-only | `getRun`, `artifacts`, `getReport` |
| `cancel_analysis` | `run_id` from active assistant turn | terminal cancelled status | owner/analyst; explicit UI only | `cancelRun` |

Rules:

- Only `create_analysis` and `get_analysis_result` are model-selectable.
- `cancel_analysis` is never model-initiated; it requires an explicit user UI action.
- Tool argument schemas contain no `org_id`, `user_id`, role, SQL, table, credential, arbitrary URL, or provider field. The server injects authority.
- The orchestrator permits at most one selected tool per turn and validates returned IDs against the bounded context and catalog.
- `unsupported` is a decision result, not a tool. It maps a fixed reason code to safe text and supported suggestions.

## 12. API Design

**Existing and retained**

- `POST /api/v1/analyses`: compatibility/direct analysis path; schedules continue to use existing repository behavior.
- `GET /api/v1/runs/:id`, `/artifacts`, `POST /cancel`, report and catalog APIs.
- `GET /api/v1/messages`: retain temporarily for compatibility, but implement via the new paged repository query or deprecate after the Agent Chat migration.

**Extended**

- Run terminal transactions finalize the linked assistant placeholder for success, failure, cancellation, and retry transitions.
- Problem responses gain stable Agent Chat codes without leaking provider bodies.

**New**

- `GET /api/v1/conversations?org_id=<id>&limit=<n>&cursor=<opaque>` returns interactive conversation summaries and `next_cursor`.
- `GET /api/v1/conversations/:id?org_id=<id>` returns authorized metadata.
- `GET /api/v1/conversations/:id/messages?org_id=<id>&limit=<n>&before=<opaque>` returns stable chronological pages and `next_cursor`.
- `POST /api/v1/conversations` submits the first `AgentTurnRequest` and creates the row only with that first turn; an empty client-side “new conversation” creates no database litter.
- `POST /api/v1/conversations/:id/messages` submits a follow-up turn.

Both POST endpoints require `Idempotency-Key`, `client_turn_id`, text, scope and `data_as_of`. The response is `202 AgentTurnAccepted` with conversation, user/assistant message IDs, optional run ID, and assistant status. The server persists the user/placeholder first, executes the bounded synchronous decision, and either attaches a queued run or finalizes an unsupported/provider error. A retry with the same key returns the same turn; a changed body returns `409 IDEMPOTENCY_CONFLICT`.

## 13. Agent End-to-End Flow

1. Client creates and retains `client_turn_id` plus an idempotency key until the request resolves.
2. API authenticates, validates origin/body, and authorizes an owner/analyst write before any message is stored.
3. Repository atomically creates/fetches the conversation, stores the user message and assistant placeholder, and touches `updated_at`.
4. Context builder loads the authoritative role/catalog, current explicit scope/date, up to 12 recent display messages, and up to 5 recent run/reference summaries from this conversation. It applies a total character/token budget.
5. Provider returns one strict decision: `create_analysis`, `get_analysis_result`, or `unsupported`.
6. Orchestrator validates all arguments and checks the selected tool against the role. It never accepts authority fields from the output.
7. `create_analysis` atomically creates the existing run, freezes snapshots/config, attaches run ID to both turn messages, and writes a `run_ref` receipt. The worker path is unchanged.
8. UI receives `202`, renders the persisted turn, and polls the existing run detail endpoint.
9. Worker emits actual task/event state and produces validated canonical artifacts/report.
10. The same terminal transaction updates the assistant placeholder and conversation timestamp. Success parts contain canonical references; failure/cancel parts contain safe error metadata.
11. UI loads referenced artifacts/report through current authorized endpoints and reuses rich renderers.
12. Reloading the conversation restores message/run references and resumes polling if the run is still active.

## 14. Progress / Streaming Strategy

Use current polling for MVP. Do not add SSE, WebSocket, or LLM token streaming.

- Initial Agent Chat decision is a bounded synchronous provider call. UI shows a neutral “Preparing analysis” pending state, not model reasoning.
- After a run exists, poll `GET /runs/:id` at the existing ~1,100 ms cadence while the tab is visible; back off when hidden and stop at terminal state.
- Map persisted task kinds to user-visible labels: orchestrator → Preparing; data → Reading frozen snapshots; calculation → Calculating metrics; comparison → Building comparison; chart → Building chart; insight → Linking insights to evidence; validation → Validating evidence; report → Preparing report.
- Show queued/running/completed/cancelled/failed from real status only. Event text must be allowlisted/presentation-mapped, not rendered as hidden reasoning.
- Token streaming is not useful because evidence-backed output must wait for canonical artifact validation.

## 15. Frontend / UX Architecture

Keep the current page and global workspace navigation. Refactor only the analysis surface into an Agent Chat composition:

```text
existing global sidebar
  +-- conversation rail (desktop; drawer/select on narrow screens)
  +-- thread
      +-- user text
      +-- assistant text/status
      +-- full-width run progress
      +-- full-width AnalysisResult / ChartRenderer
      +-- EvidenceDrawer / report actions
      `-- sticky composer with project/zone/date context chips
```

Text remains readable and narrow; structured results are not forced into speech bubbles. Reuse current design tokens, focus behavior, `aria-live`, dialog semantics, responsive breakpoints, and error/loading patterns. The existing “analysis” tab becomes the Agent Chat surface; do not add a parallel `/chat` app.

Supported empty-state prompts are limited to current semantic capabilities:

- Show current available inventory.
- Which units are slow moving?
- Compare available inventory with 30 days ago.
- Show current price distribution.
- Generate an inventory report.

Do not suggest sales causes, reservation lifecycle, price-event analytics, multi-project portfolio analysis, or other unsupported semantics.

## 16. Security Model

- `principal()` remains the only source of user identity. Repository membership remains the authority for organization and role.
- The client sends an organization and scope as requested resources, not authority. The repository/catalog must prove membership and existence.
- Tool execution context is created server-side and includes authenticated user, authorized organization, role, conversation and turn IDs. It is not serialized into the model prompt.
- Re-authorize immediately before every tool execution. Owner/analyst may start/cancel analysis; viewer may browse authorized persisted conversations/results but may not submit a turn that can mutate state. The MVP composer remains disabled for viewers to avoid an ambiguous read-only chat mode.
- Existing authenticated SELECT grants plus workspace RLS remain. Direct writes by `anon`/`authenticated` remain revoked; server/repository writes remain explicitly authorized.
- Conversation ownership does not create a private ACL. Current product semantics are workspace collaboration; tests must document this explicitly.
- Prompt/tool output is untrusted input: strict Zod schema, exact action enum, catalog/run allowlist, max lengths, one action, and no unknown keys.
- Do not log raw prompts/provider responses by default. Logs may include request IDs, provider, latency, decision kind, run ID, error code, and hashed input identifiers.
- Preserve `store: false` for OpenAI. Do not expose provider keys or database credentials to tools/model/client.

## 17. Infrastructure Decision

**Existing infrastructure sufficient: YES.**

PostgreSQL already provides durable conversation storage and the leased run queue. The worker/DAG provides long-running execution. Existing tasks/events provide progress; existing polling provides delivery; artifacts/reports provide canonical results; Supabase Auth and RLS provide tenancy. No limitation in the current MVP justifies Redis, Kafka, RabbitMQ, BullMQ, another database, vector search, MCP, Python, LangChain/LangGraph, a new event bus, or Kubernetes.

## 18. Existing Files To Reuse

- `src/backend/packages/contracts/src/index.ts`: central Zod/API contracts.
- `src/backend/packages/semantic/src/index.ts` and `registry.ts`: supported analytics and semantic guardrails.
- `src/backend/packages/domain/src/integrity.ts`: lineage/publication validation.
- `src/backend/packages/agents/src/index.ts`: existing DAG and completion path.
- `src/backend/packages/agents/src/provider.ts`: provider configuration, structured output and fallback pattern.
- `src/backend/packages/db/src/repository.ts` and `types.ts`: transaction, authorization and persistence conventions.
- `src/backend/worker/src/index.ts`: leased queue consumer.
- `src/frontend/src/server/context.ts` and `api.ts`: authentication/BFF conventions.
- `src/frontend/src/lib/client-api.ts`: browser API boundary and response validation.
- `src/frontend/src/components/workspace.tsx`: page state/navigation/polling.
- `analysis-result.tsx`, `chart-renderer.tsx`, `evidence.tsx`, and `resource-panels.tsx`: rich results and established UI patterns.
- Existing Vitest, PGlite, pgTAP and Playwright setup.

## 19. Files To Modify

- Contracts, DB repository interface/implementation/tests, agent provider/index exports/tests, BFF API, client API, workspace, global styles, pipeline tests, e2e tests, RLS tests, and security checker.
- Exact paths and changes are specified in Part II section 27.

## 20. New Files

- `src/backend/supabase/schemas/005_agent_chat.sql`
- CLI-generated `src/backend/supabase/migrations/<timestamp>_agent_chat.sql` (do not invent the timestamp by hand)
- `src/backend/packages/agents/src/chat.ts`
- `src/backend/packages/agents/src/chat.test.ts`
- `src/backend/packages/agents/src/tools.ts`
- `src/backend/packages/agents/src/tools.test.ts`
- `src/frontend/src/components/agent-chat/agent-chat.tsx`
- `src/frontend/src/components/agent-chat/conversation-list.tsx`
- `src/frontend/src/components/agent-chat/message-thread.tsx`
- `src/frontend/src/components/agent-chat/composer.tsx`
- `src/frontend/src/components/agent-chat/run-progress.tsx`
- `src/frontend/src/components/agent-chat/agent-chat.test.tsx`

Do not create files until their phase is reached, and do not create a barrel or abstraction that has only one consumer unless required for client/server separation.

## 21. Database Changes

Create an additive declarative schema file because the project already loads `schemas/*.sql` lexically and uses additive schema files. It should alter existing `conversations` and `messages`, add constraints/indexes, and preserve the existing membership RLS policy/grants. Generate the migration from the declarative state with the Supabase CLI and review it.

Because schema diff does not capture data manipulation, the generated migration must include an explicitly reviewed, idempotent backfill for existing rows: timestamps/roles/status from message payloads where possible, deterministic conversation timestamps/title/kind, and scheduled kind inferred from existing run entrypoints. Defaults must keep the migration safe even when old payloads are incomplete. `client_turn_id` remains nullable for legacy rows and is required by new API contracts.

Update `src/backend/scripts/check-security.ts`: it currently compares only `001_inventory.sql` byte-for-byte to the initial migration and checks `CREATE TABLE` declarations only in that file. Keep the initial parity assertion, then additionally inspect all declarative schema files/migrations for expected Agent Chat columns/indexes, existing RLS/grants, and absence of authenticated writes. Otherwise the security check gives false confidence after additive schemas.

## 22. Things We Should NOT Build

- A text-only general chatbot or arbitrary SQL agent.
- A second semantic engine, chart model, artifact store, report model, auth layer, queue, worker, cancellation system, or progress event system.
- Multi-agent routing, recursive ReAct loops, memory embeddings, vector retrieval, MCP/plugin infrastructure, or shell/filesystem tools.
- SSE/WebSocket/token streaming for MVP.
- Per-user private conversations unless product requirements explicitly replace current workspace-sharing semantics.
- Copied artifact/chart/evidence/report payloads in messages.
- Hidden chain-of-thought storage or UI that simulates it.
- Suggested prompts for capabilities absent from semantic v0.2.

## 23. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Structured decision returns a valid shape but wrong scope/run | Cross-scope or misleading action | Server validates against current catalog and bounded run allowlist; authority never comes from model |
| Provider latency/failure before run creation | Slow/failed send | Persist placeholder first; 30 s bound, fallback, safe terminal error, idempotent retry |
| Assistant placeholder and run diverge | Reload shows stale state | Create/attach atomically; terminal run/message/report updates in one transaction; unique constraints |
| Current message payloads lack new fields | Parse/migration failure | backward-compatible contract defaults/normalizer plus reviewed backfill |
| Workspace-shared history surprises users | Privacy expectation mismatch | label workspace visibility and test it; do not silently introduce creator-only ACL |
| Conversation queries degrade | Slow history UI | keyset pagination and composite indexes; no offset pagination |
| LLM appears to answer unsupported analytics | Loss of trust | strict supported-action schema, semantic registry allowlist, honest unsupported/abstain states |
| Current fixed DAG does not target arbitrary questions | Answer may be broader than prompt | state MVP supported prompt set and render relevant canonical sections; do not claim general analytics |
| Security checker misses additive schema | RLS/grant regression | update checker to scan all schemas and add pgTAP cases |
| Polling multiplies with many historical turns | API load | poll only active visible run(s), stop terminal, resume from persisted refs |
| Working tree contains a large unrelated migration | Accidental overwrite | focused files/hunks, review status/diff before every phase, no cleanup/reset |

## 24. Recommended Implementation Phases

1. **Contracts and database foundation** — establish compatible conversation/message/turn schemas, declarative SQL, generated migration, indexes, RLS/security tests.
2. **Repository vertical slice** — create/list/page turns, attach a run, terminally finalize assistant placeholders, idempotency and cross-tenant tests.
3. **Typed tools and orchestrator** — bounded context, structured provider decision, role checks, provider fallback/error normalization.
4. **Conversation API and browser client** — new endpoints, response contracts, error mapping, compatibility of old endpoints.
5. **Agent Chat UI** — conversation navigation, message thread, composer/context, real progress, cancellation and renderer reuse.
6. **End-to-end hardening** — failure/cancel/retry/reload/abstain/RLS/e2e, security/docs checks and full validation.

---

# Part II — VDaAgent Agent Chat Implementation Plan

## 1. Objective

Deliver a workspace-aware, persistent, evidence-first analytics Agent Chat in which an owner or analyst can start a conversation, submit a supported natural-language inventory request, see real pipeline progress, receive the existing canonical metric/chart/evidence/report result, follow up in context, cancel an active run, and restore the conversation after reload. A viewer can browse workspace conversations/results but cannot create/cancel analysis.

The implementation is complete only when the vertical slice persists both sides of every turn, drives the existing deterministic pipeline through a typed capability, renders canonical references, preserves tenancy/roles, and passes the validation gates in section 29.

## 2. Current Architecture Summary

The monorepo uses pnpm/Turbo with `@vda/contracts`, `@vda/config`, `@vda/db`, `@vda/domain`, `@vda/semantic`, `@vda/agents`, `@vda/worker`, and a Next.js 16 frontend. The browser calls a same-origin Next route handler/BFF. PostgreSQL stores queue and domain records. A separate Node worker claims fenced leases and runs a deterministic DAG. The UI polls and renders typed artifacts.

Current constraints that drive this plan:

- The working tree is an in-progress, uncommitted TypeScript migration; do not restore deleted Python code or use old docs as architecture.
- Messages/conversations already exist but are run-centric and not listable/pageable.
- `@vda/semantic` is authoritative for numbers and null/abstain semantics.
- The current provider can only select verified claims; it is not a general agent runtime.
- Existing organization membership semantics are workspace-shared.

## 3. Architecture Decision

Implement one bounded orchestrator in `@vda/agents`, backed by a strict decision provider and four typed server capabilities. The orchestration request stays in the BFF process and dispatches at most one model-selected tool. Long work remains in the current PostgreSQL queue/worker/DAG. Conversation/message state extends current tables. Progress continues via polling.

Decision records:

- **Single agent vs multi-agent:** single orchestrator; existing DAG is deterministic execution, not a fleet of chat agents.
- **Persistence:** extend `conversations`/`messages`; no parallel chat schema.
- **Message representation:** relational lifecycle/query columns plus typed reference-only JSONB parts.
- **Provider:** Gemini primary/OpenAI fallback remains; no xAI dependency.
- **Delivery:** polling remains; no token streaming/SSE/WebSocket.
- **Infrastructure:** existing infrastructure sufficient.

## 4. Scope

- Interactive conversation list, open/resume, first turn and contextual follow-up.
- Deterministic title and stable keyset pagination.
- Structured action selection for supported inventory analysis or an existing result reference.
- User/assistant lifecycle persistence for queued, running, completed, failed and cancelled states.
- Real task progress, cancellation and reload recovery.
- Reuse of metric, chart, evidence, report and artifact renderers.
- Owner/analyst writes; viewer read-only; workspace RLS.
- Provider, repository, API, frontend, RLS, integration and e2e tests.

## 5. Out of Scope

- New analytics/metrics, semantic version changes, causal inference, sales lifecycle, portfolio queries or arbitrary SQL.
- Per-user private threads, conversation sharing controls, branching/forking, search, rename/archive/delete, attachments or voice.
- LLM token streaming, SSE, WebSocket, background agent-turn queue, vector memory or conversation summarization jobs.
- Generic tools/plugins/MCP, Python/xAI service, multi-agent workflows or shell/filesystem access.
- Mobile-native applications or a second frontend route/application.

## 6. Existing Components To Reuse

| Existing component | Reuse |
| --- | --- |
| `AnalysisRequestSchema`, run/task/event/artifact/report contracts | compose Agent Chat contracts from them |
| `SqlRepository.auth`, `catalog`, `selectLatest`, `buildRun` internals | authorization, scope proof, snapshot freeze and run creation |
| `claimRun`, lease/fencing, `executeLease` | unchanged long-running execution |
| semantic registry and artifact validators | only authority for analytics/evidence |
| `NarrativeProvider` and provider configuration | keep verified narration; mirror adapter/fallback pattern for decisions |
| API `body`, `json`, origin check, principal/repository context | all new conversation endpoints |
| `api<T>` conventions in `client-api.ts` | typed no-store browser calls |
| current Workspace scope fields and run polling | composer context and active progress |
| `AnalysisResult`, `ChartRenderer`, `EvidenceDrawer`, report body | hydrate/render reference parts |
| PGlite repository tests, pgTAP RLS, Vitest and Playwright | test implementation |

## 7. Data Model Changes

Define these contract-level records:

```text
Conversation
  conversation_id, org_id, created_by
  kind: interactive | scheduled
  title
  created_at, updated_at

Message
  message_id, org_id, conversation_id, run_id?
  client_turn_id?
  role: user | assistant
  status: submitted | in_progress | completed | failed | cancelled
  content
  parts: MessagePart[]
  created_at, updated_at

MessagePart
  text { text }
  run_ref { run_id, status }
  report_ref { run_id, report_id }
  artifact_ref { run_id, artifact_id, kind }
  error { code, retryable }
```

`content` and `text` contain prose only. `artifact_ref.kind` is display metadata validated against the hydrated artifact; it is not trusted as canonical. Never put metric values, chart series or evidence records in parts.

Repository read adapters must normalize legacy message payloads lacking `status`, `parts`, `updated_at`, or `client_turn_id`: default to `completed`, create one `text` part from `content`, use `created_at` as `updated_at`, and preserve nullable turn ID. New writes must always satisfy the new complete schema.

## 8. Contract Changes

In `src/backend/packages/contracts/src/index.ts`:

1. Add `ConversationKindSchema`, `ConversationSchema`, `ConversationListItemSchema` and cursor-page response schemas.
2. Add strict `MessageStatusSchema` and discriminated `MessagePartSchema`; extend `MessageSchema` compatibly.
3. Add `AgentTurnRequestSchema` with `org_id`, `client_turn_id`, text, `ScopeSchema`, and `data_as_of`; conversation ID comes from the route or is null for first turn.
4. Add `AgentTurnAcceptedSchema` containing conversation/user/assistant IDs, nullable run ID, and assistant status.
5. Add strict decision/tool argument/result schemas. `AgentDecisionSchema` is a discriminated union of `create_analysis`, `get_analysis_result`, and `unsupported` with enumerated reason codes.
6. Add `ConversationPageSchema` and `MessagePageSchema` with opaque nullable cursors and bounded limits (default 30, maximum 100).
7. Keep `AnalysisRequestSchema` and `AcceptedSchema` for existing callers.
8. Export all inferred types from the existing package entry point; do not create a second contracts package.

Definition of done:

- All schemas reject unknown keys, invalid IDs, oversized text, authority fields and invalid action/tool combinations.
- Old message payload fixtures normalize without changing canonical analytics.
- Contract tests cover each part/action, limits and malformed tool arguments.

## 9. Repository Changes

In `src/backend/packages/db/src/types.ts`, add methods with typed page/turn results:

- `listConversations(userId, orgId, page)`
- `getConversation(userId, orgId, conversationId)`
- `listMessages(userId, orgId, conversationId, page)`
- `startTurn(userId, input, idempotencyKey, conversationId?)`
- `attachRunToTurn(userId, turnContext, analysisRequest, idempotencyKey)`
- `finalizeTurn(...)` only for pre-run unsupported/provider failures; run terminal paths finalize run-linked turns.

Refactor `repository.ts` carefully:

- Extract the common run insert/snapshot-freeze body from `buildRun` without altering current schedule/direct-analysis behavior.
- `startTurn` authorizes write first, locks the organization/conversation as needed, enforces idempotency/body hash, creates or verifies an interactive conversation, inserts the user and assistant placeholder, and updates conversation metadata in one transaction.
- `attachRunToTurn` re-authorizes, locks both messages, verifies they are still pending and owned by the same org/conversation/turn, inserts the run and frozen snapshots, then attaches `run_id` and `run_ref` to both messages atomically.
- `completeRun` updates the existing assistant placeholder instead of inserting a second assistant message. In the same transaction it publishes the report, adds `report_ref` plus validated artifact refs, sets completed, and touches the conversation.
- `failRun` and `cancelRun` set a safe error/cancel part and terminal assistant status in the same transaction. `retryRun` changes the same assistant placeholder back to `in_progress` and preserves the run reference.
- Legacy/direct/scheduled `createRun` also creates a placeholder so terminal paths are uniform; set conversation kind from `entrypoint`.
- Perform ordering and cursor predicates in SQL, not in-memory. Cursor encode/decode helpers must be deterministic and reject malformed input.
- Every lookup predicates on `org_id`; every write reuses `auth(..., true)`; no model-derived identity enters these methods.

Definition of done:

- Repeated same idempotency key/body returns the same turn/run; changed body is 409.
- A crash/retry after `startTurn` can safely resume the pending turn.
- There is exactly one user and one assistant message per client turn and at most one assistant per run.
- Terminal run and assistant state cannot disagree after a committed transaction.
- Cross-tenant, missing-membership and viewer write tests fail closed.

## 10. Agent Orchestrator

Create `src/backend/packages/agents/src/chat.ts` with:

- `ConversationContextBuilder`: obtains authoritative catalog/role, current explicit context, the latest 12 display messages and latest 5 run reference summaries; removes parts not needed for language understanding; enforces per-item and total character limits.
- `AgentChatOrchestrator`: calls `startTurn`, obtains a structured decision, validates it, dispatches exactly one tool, and finalizes safe errors. Dependency-inject the repository, decision provider, clock and ID source for tests.
- Deterministic response templates for unsupported, permission, invalid reference and provider-unavailable cases. Do not let provider text become a factual answer.
- An allowlist that only permits currently supported inventory intents/windows (current, 7/30/90-day comparison, slow-moving, price distribution, peer comparison where semantic requirements are met, and full report).

The orchestrator must not expose a recursive loop. One provider decision and one selected tool is the hard limit. A tool result is not sent back for an unconstrained second completion; the existing report/narrative pipeline owns evidence-backed synthesis.

Definition of done:

- A supported turn creates one run through the tool registry.
- A valid existing-result reference creates no run and only stores authorized refs.
- Unsupported/provider-error turns remain durable without a run.
- No prompt contains credentials, raw database rows, hidden reasoning or unlimited history.

## 11. Typed Tools

Create `src/backend/packages/agents/src/tools.ts`:

- Define `AgentToolExecutionContext` server-side: authenticated user, org, role, conversation/user/assistant message IDs, client turn ID and idempotency key.
- Define a small registry keyed by the exact names in Part I section 11.
- Each executor parses its own input again, checks role, invokes repository methods, validates output, and emits a stable error code.
- `get_analysis_result` accepts only run IDs included by the context builder, then relies on repository authorization and returns IDs/status/kinds only.
- `cancel_analysis` is exported for API/UI use but excluded from model tool definitions.

Definition of done:

- Invalid args never reach repository methods.
- Viewer mutation, out-of-context run ID and cross-tenant scope are rejected.
- Tools cannot execute arbitrary SQL or receive DB/provider credentials.
- Tests prove the registry has no unreviewed tool name and no more than one mutating execution per turn.

## 12. Provider Integration

Extend `src/backend/packages/agents/src/provider.ts` rather than replacing current narration:

- Add `AgentDecisionProvider.decide(context): Promise<AgentDecisionResult>`.
- Implement Gemini JSON-schema and OpenAI Responses/Zod adapters using the current models, order, `store: false`, temperature/structured constraints, 30 s timeout and max retry conventions.
- Build a separate strict instruction stating supported intents, no calculations/claims/SQL, no authority fields, exact IDs only from context, and one action.
- Add a fallback wrapper that records safe provider/error category internally and exposes only `ALL_AGENT_PROVIDERS_FAILED` after exhaustion. Keep raw response/body out of client errors.
- Keep `NarrativeProvider` behavior and tests intact. Do not couple the chat decision schema to xAI SDK types.

Definition of done:

- Both providers produce the identical application decision type.
- Unknown actions/IDs/fields, invalid JSON, timeout and network errors are covered.
- Fallback receives identical bounded context and cannot silently widen capability.

## 13. API Changes

In `src/frontend/src/server/api.ts`:

- Add route matching and Zod serialization for the five new GET/POST endpoints in Part I section 12.
- Parse cursor/limit through contracts; never interpolate cursors into SQL.
- Require `Idempotency-Key` on both turn POSTs and pass the authenticated principal to the orchestrator.
- Preserve current same-origin mutation guard, content-type/body limit, private no-store headers and RFC-style problem mapping.
- Map repository/orchestrator errors to stable statuses: 400 invalid cursor/input, 403 permission, 404 conversation/scope/ref, 409 idempotency/terminal conflict, 422 unsupported semantic input where appropriate, 503 provider unavailable.
- Keep `/analyses`, `/messages`, run/artifact/report endpoints backward compatible during migration.

In `src/frontend/src/lib/client-api.ts`:

- Add list/detail/page/send helpers that parse the new contracts.
- Make `sendTurn` reuse its idempotency key/client turn ID on network retry.
- Keep all API access same-origin; do not import server-only packages into client components.

Definition of done:

- Endpoints return only schema-validated data and correct no-store headers.
- Conversation access is denied before data disclosure.
- Network retries do not duplicate a turn or run.

## 14. Worker / Run Integration

Do not change the DAG, claim loop, lease interval, queue type, task kinds or semantic calculations.

Modify terminal repository calls used by `src/backend/packages/agents/src/index.ts` and `src/backend/worker/src/index.ts` so the already-created assistant placeholder is finalized transactionally. Preserve fencing: a stale worker must be unable to update either the run or message. Ensure the worker's outer failure handler can safely call `failRun` once; repeated terminal calls are idempotent or return a documented terminal conflict without corrupting the turn.

Map actual task state to UI labels in the frontend rather than adding synthetic tasks. A cancelled run clears its lease and increments its fencing token through the existing path.

Definition of done:

- Existing pipeline tests still validate all artifact lineage/publication gates.
- Success, fail, cancel and retry leave coherent run/message/conversation state.
- Scheduled/direct runs continue to work and do not pollute the interactive conversation list (`kind=scheduled`).

## 15. Frontend Architecture

Create an `agent-chat` component folder and keep `workspace.tsx` as the owning shell:

- `agent-chat.tsx` coordinates selected conversation, pages, active run hydration and responsive layout.
- `conversation-list.tsx` renders keyset-paged workspace conversations, status/time/title and new-conversation action.
- `message-thread.tsx` renders user/assistant content and dispatches typed parts to existing rich renderers.
- `composer.tsx` owns the draft only; scope/date remain controlled by the workspace/catalog state.
- `run-progress.tsx` renders allowlisted real task/status labels and stop action.

Extract only the analysis-specific state from `WorkspaceShell`; leave report/schedule/import/history panels and global navigation unchanged. Do not introduce a new state library. Use React state/effects consistent with current code.

Definition of done:

- Switching conversations cancels obsolete fetches/polls and cannot flash another thread's data.
- Only the active non-terminal run is polled.
- Desktop and <=720 px layouts remain usable; keyboard/focus behavior is preserved.

## 16. Conversation Navigation

- “New conversation” creates local empty state; the server row is created with the first successful submission.
- List shows interactive conversations ordered by latest update with deterministic title and current terminal/active indicator.
- Opening loads metadata plus newest message page. “Load earlier” uses cursor pagination without reordering/duplicates.
- URL routing is not required for MVP because the current application is stateful in one workspace page. If deep links become a product requirement, add them as a follow-up rather than inventing an unreviewed route now.
- On organization switch, clear selected conversation/run/draft context and refetch; never reuse IDs across organizations.

Definition of done:

- Conversation survives reload within current workspace session.
- List/page cursors are stable when a new message arrives.
- Scheduled conversations are excluded by default.

## 17. Message Rendering

- Render `content`/`text` as plain text with preserved line breaks; do not add arbitrary HTML/Markdown execution in this feature.
- User text uses a compact bubble; assistant explanation/status uses readable narrow text.
- `run_ref` renders `RunProgress` while active and a stable run link/status when terminal.
- `error` uses accessible severity, safe code-to-copy mapping and retry action only when retryable.
- Unknown future part types fail closed with an “unsupported message part” diagnostic in development and no dangerous rendering in production.
- Use stable message IDs as React keys and an `aria-live="polite"` region for status changes; do not continuously re-announce charts.

Definition of done:

- Pending, completed, failed and cancelled turns are distinguishable after reload.
- Legacy text-only messages still render.
- No message part can inject HTML or reference another organization.

## 18. Structured Result Rendering

- Hydrate a successful `run_ref` through existing run/artifact APIs once terminal.
- Pass the canonical artifact collection into the existing `AnalysisResult`; keep chart data in `ChartRenderer` and evidence in `EvidenceDrawer`.
- `report_ref` opens/reuses the current report detail/action path; `artifact_ref` is a focus hint, not a copied payload.
- Keep structured cards full-width relative to the thread and text narrower.
- Preserve semantic null/abstain/insufficient-peer display from existing renderers. Never substitute zero or confident prose.

Definition of done:

- Metric, comparison, chart, insight, evidence and report views match existing canonical rendering.
- A tampered/missing reference yields a safe error, not stale cached data.
- UI performs no business calculation.

## 19. Composer

- Multiline text input, Send, explicit Stop for active run, and New conversation.
- Display current Project, optional Zone and As-of date as visible context controls/chips using existing `ScopeFields` behavior.
- Disable Send when invalid, empty, a submission is awaiting the initial decision, or the current role is viewer. Preserve the draft on network/provider failure.
- Generate `client_turn_id` with `crypto.randomUUID()` and a separate idempotency key once per attempted turn; reuse both on retry.
- Do not permit parallel sends in the same conversation for MVP. A different conversation may be opened, but avoid background polling more than its persisted active indicator requires.

Definition of done:

- Enter/modified-Enter behavior is documented in accessible help text; IME composition does not accidentally submit.
- Stop invokes only the existing cancellation endpoint for the referenced active run.
- Supported suggestion chips populate/submit through the same validation path as typed text.

## 20. Progress / Polling / Streaming

- Continue the 1,100 ms active polling cadence already used in `workspace.tsx`.
- Move polling into the Agent Chat coordinator or a narrowly scoped hook only if this avoids duplication; abort on conversation/run changes and component unmount.
- On terminal response, refetch the message page and artifacts once, then stop polling.
- Pause/back off while `document.visibilityState !== 'visible'`; immediately refresh on visibility return.
- No LLM token streaming, SSE, WebSocket or optimistic fake task steps.

Definition of done:

- Network trace shows no polling after terminal state or for historical runs.
- All labels correspond to a real `RunTask.kind`/status or run queue state.
- Cancellation becomes visible without a page reload.

## 21. Evidence and Lineage

- Preserve artifact `source_refs`, snapshot refs, input artifact refs, hashes and validations exactly.
- Chat messages store only `run_id`, `artifact_id`, `report_id` and safe display kind/status.
- Only render successful artifacts after current authorization and validation hydration. Failed validation remains an analysis failure; do not show an unvalidated “best effort” answer.
- Reuse the current evidence drawer and source/import metadata. Include run ID, data-as-of, semantic version and provisional limitation where current components already expose them.

Definition of done:

- Every factual/numeric UI element traces to a canonical artifact and frozen snapshot/source.
- Chat adds no new provenance store and makes no evidence-free claim.

## 22. Permissions and Security

Required tests and invariants:

- Owner and analyst can create/cancel Agent Chat analysis; viewer cannot submit/cancel/import/trigger schedule through chat.
- All members of organization A can read A's conversations (documented workspace collaboration); no member of B can infer existence/title/message/run IDs from A.
- Conversation ID, run ID and scope are checked together with organization on every repository query.
- RLS still permits only authenticated workspace SELECT and denies direct authenticated mutations.
- Model/client cannot override user, org or role; tool schemas contain none of these authority fields.
- Origin, body size, JSON content type, no-store headers, secrets boundary and development bypass rules remain.
- Provider input is bounded and excludes raw artifact/database payloads unless an explicitly safe summary/reference field is required.

## 23. Error Handling

| Condition | Persisted/UI behavior | Retry |
| --- | --- | --- |
| Unsupported request | completed assistant text + `UNSUPPORTED_REQUEST`; supported suggestions; no run | edit prompt |
| Permission denied | HTTP 403 before message persistence for viewer/membership failure | after permission change only |
| Invalid input/scope/cursor | 400/404/422 with field-safe detail; preserve draft | after correction |
| Provider network/timeout/all failed | assistant `failed`, `PROVIDER_UNAVAILABLE`, no invented answer | same turn key may safely resume/retry |
| Invalid provider decision/tool args | assistant `failed`, stable validation code; no tool execution | retryable only if provider fallback exhausted transiently |
| Analysis failed | run-linked assistant `failed` with safe run error code | current `retryRun` policy, max attempts |
| Run cancelled | assistant `cancelled`; retain run ref/audit | new turn or explicit retry policy |
| Semantic abstain/missing data | completed canonical result showing unavailable/abstain | change scope/date/data |
| Insufficient peers | canonical null/limitation, no cohort widening | change supported scope only |
| Artifact validation failure | run/assistant failed; do not render invalid artifact | investigate/retry run |
| Browser/network error | keep draft/pending local indicator; reload from persisted turn before retry | reuse IDs/key |

## 24. Database / RLS / Migration

1. Add `src/backend/supabase/schemas/005_agent_chat.sql` with additive `ALTER TABLE`, constraints and indexes described in Part I section 10.
2. Keep existing RLS on both tables. Revoke all writes from `PUBLIC`, `anon`, and `authenticated`; retain `SELECT` for `authenticated` and `ALL` for `service_role`, matching project convention.
3. Add indexes:
   - conversations `(org_id, kind, updated_at DESC, id DESC)`;
   - messages `(org_id, conversation_id, created_at, id)`;
   - partial unique turn/role on `(org_id, conversation_id, client_turn_id, role)` where turn ID is non-null;
   - partial unique run/role on `(org_id, run_id, role)` where run ID is non-null.
4. Keep `client_turn_id` nullable only for legacy data; application contracts require it for new Agent Chat writes.
5. Generate, do not hand-name, the migration:

   ```bash
   pnpm exec supabase --workdir src/backend db diff -f agent_chat
   ```

6. Review the CLI-generated migration and add the necessary idempotent legacy backfill because declarative diff does not capture DML. Never run a destructive reset against production.
7. Extend `tenant_rls.test.sql` for cross-tenant conversation/message reads and all direct mutation verbs.
8. Update `check-security.ts` to understand all declarative schemas and the additive migration; do not replace its existing client-secret checks.

Definition of done:

- Fresh database and upgraded database reach the same final schema.
- RLS/grants are explicit and pgTAP proves tenant isolation/direct-write denial.
- Query plans use the composite indexes for normal list/page predicates.

## 25. Testing Strategy

| Layer | Tests |
| --- | --- |
| Contracts | strict unions, defaults/legacy normalization, cursors, limits, authority-field rejection |
| Repository/PGlite | list/page ordering, idempotent start/attach, terminal atomicity, retry, legacy messages, cross-tenant, viewer |
| RLS/pgTAP | workspace read, other-org denial, authenticated write denial for conversation/message |
| Tools | args, role matrix, out-of-context refs, one mutation, typed errors |
| Orchestrator | supported/create, existing result, unsupported, provider fail/fallback, bounded context, no second tool |
| Provider | Gemini/OpenAI structured decisions, malformed output, unknown IDs, timeout and fallback |
| Pipeline | placeholder finalized on success/failure/cancel/retry; validation/fencing remain intact |
| API | endpoint/method/status/headers, cursors, idempotency, auth and problem mapping |
| Frontend/Vitest | list/thread/composer/progress/part rendering, viewer disabled, polling cleanup, legacy text |
| Integration | persisted turn → queued run → worker → report refs; failure and cancellation |
| Playwright | first conversation, follow-up/reload, rich artifacts/evidence, cancel, viewer/cross-tenant |

Do not mock away the repository authorization or semantic/artifact validation in integration tests. Provider tests may use the existing deterministic fixture/adapter.

## 26. Implementation Sequence

```text
0. Re-check working tree and current symbols
   -> 1. Contracts + compatibility tests
   -> 2. Declarative schema + generated/reviewed migration + RLS tests
   -> 3. Repository pages/turn lifecycle + PGlite tests
   -> 4. Typed tools + tests
   -> 5. Decision provider + bounded orchestrator + tests
   -> 6. BFF API + client API + API tests
   -> 7. Worker terminal integration + pipeline tests
   -> 8. Conversation UI + renderer reuse + component tests
   -> 9. E2E/security/docs/full validation
```

Phase gates:

- Do not start provider/orchestrator work until repository turn idempotency and terminal atomicity pass.
- Do not build UI against provisional hand-written shapes; contracts/API helpers must be merged first.
- Do not declare the vertical slice complete until reload, cancellation, viewer denial, cross-tenant denial, and artifact validation are tested.
- At each phase, review `git status` and stage/review only that logical functionality if the user later requests commits.

## 27. File-by-File Change List

| Order | File | Action | Exact Change | Depends On | Tests |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/backend/packages/contracts/src/index.ts` | modify | add conversation/message part/status/page/turn/decision/tool schemas and types; retain legacy analysis contracts | none | contract cases in agent/repository/API tests |
| 2 | `src/backend/supabase/schemas/005_agent_chat.sql` | new | alter conversations/messages; constraints, defaults and composite/partial indexes; preserve grants/RLS | contracts/data model | db reset/diff, pgTAP |
| 3 | `src/backend/supabase/migrations/<CLI-generated-timestamp>_agent_chat.sql` | new | CLI-generated DDL plus reviewed idempotent legacy DML backfill | schema file | fresh and upgrade paths |
| 4 | `src/backend/supabase/tests/tenant_rls.test.sql` | modify | conversation/message same-workspace reads, cross-tenant denial, direct write denial | migration | `pnpm test:db` |
| 5 | `src/backend/scripts/check-security.ts` | modify | scan additive schemas/migrations, required indexes/grants/RLS; keep existing secret/client-boundary checks | schema | `pnpm check:security` |
| 6 | `src/backend/packages/db/src/types.ts` | modify | add conversation pages and turn lifecycle methods/types | contracts | TypeScript |
| 7 | `src/backend/packages/db/src/repository.ts` | modify | SQL keyset pages, start/attach/finalize lifecycle, refactor run insert, placeholder terminal updates, legacy normalization | schema/contracts | repository/PGlite tests |
| 8 | `src/backend/packages/db/src/repository.test.ts` | modify | idempotency, pagination, role/tenant, terminal atomicity, scheduled filtering, legacy cases | repository | `pnpm test` |
| 9 | `src/backend/tests/unit/pipeline.test.ts` | modify | assistant placeholder success/fail/cancel/retry and canonical refs | repository | `pnpm test` |
| 10 | `src/backend/tests/unit/postgres-pipeline.test.ts` | modify | real SQL lifecycle, fencing and publication transaction | repository | `pnpm test` |
| 11 | `src/backend/packages/agents/src/tools.ts` | new | strict tool context/registry/executors; UI-only cancellation exclusion | repository/contracts | tools test |
| 12 | `src/backend/packages/agents/src/tools.test.ts` | new | invalid args, viewer/cross-tenant/ref allowlist, mutation limit | tools | `pnpm test` |
| 13 | `src/backend/packages/agents/src/provider.ts` | modify | add decision interface/adapters/fallback/error normalization; preserve narration | contracts | provider tests |
| 14 | `src/backend/packages/agents/src/provider.test.ts` | modify | Gemini/OpenAI decision parsing, invalid output, timeout/fallback | provider | `pnpm test` |
| 15 | `src/backend/packages/agents/src/chat.ts` | new | bounded context builder and one-decision/one-tool orchestrator | provider/tools | chat test |
| 16 | `src/backend/packages/agents/src/chat.test.ts` | new | supported/result/unsupported/failure/bounds/idempotent resume | chat | `pnpm test` |
| 17 | `src/backend/packages/agents/src/index.ts` | modify | export chat/tool types; keep DAG; ensure completion uses placeholder terminal path | repository/chat | pipeline tests |
| 18 | `src/backend/worker/src/index.ts` | modify | safe terminal failure integration only if required by new idempotent finalization | repository | pipeline/worker tests |
| 19 | `src/frontend/src/server/api.ts` | modify | new conversation endpoints, orchestrator wiring, schemas, error/status/cursor/idempotency handling | chat/repository | API + e2e |
| 20 | `src/frontend/src/lib/client-api.ts` | modify | typed conversation/page/send calls and retry-stable turn IDs/keys | API/contracts | frontend tests |
| 21 | `src/frontend/src/components/agent-chat/conversation-list.tsx` | new | paged list/new/select/responsive semantics | client API | component test |
| 22 | `src/frontend/src/components/agent-chat/message-thread.tsx` | new | safe text/typed reference/error rendering and legacy fallback | contracts/renderers | component test |
| 23 | `src/frontend/src/components/agent-chat/run-progress.tsx` | new | actual task label/status mapping and explicit stop | run API | component test |
| 24 | `src/frontend/src/components/agent-chat/composer.tsx` | new | multiline draft/context/send/stop/viewer/idempotent retry | client API | component test |
| 25 | `src/frontend/src/components/agent-chat/agent-chat.tsx` | new | coordinate selection, pages, hydration, polling and aborts | child components | component/e2e |
| 26 | `src/frontend/src/components/agent-chat/agent-chat.test.tsx` | new | conversation/load/reload/render/poll cleanup/viewer/network states | Agent Chat UI | `pnpm test` |
| 27 | `src/frontend/src/components/workspace.tsx` | modify | replace analysis surface with Agent Chat; retain other tabs/scope catalog | Agent Chat | frontend/e2e |
| 28 | `src/frontend/src/components/analysis-result.tsx` | reuse/modify only if needed | accept already-supported hydrated artifact bundle; no metric logic change | message thread | current + new tests |
| 29 | `src/frontend/src/components/chart-renderer.tsx` | reuse | no feature change; render canonical chart artifacts | structured result | existing chart test |
| 30 | `src/frontend/src/components/evidence.tsx` | reuse/modify only if needed | open from message result while retaining current authorization/data shape | structured result | component/e2e |
| 31 | `src/frontend/src/components/resource-panels.tsx` | reuse/modify only if needed | share timestamp/status patterns; do not duplicate history | conversation list | e2e |
| 32 | `src/frontend/src/app/globals.css` | modify | scoped Agent Chat layout/responsive/focus styles using current tokens | components | visual/e2e |
| 33 | `src/backend/tests/e2e/mvp.spec.ts` | modify | first/follow-up/reload/progress/artifact/cancel/viewer/cross-tenant flows | full stack | `pnpm test:e2e` |
| 34 | `docs/REQUIREMENT_TRACEABILITY.md` | modify | map Agent Chat acceptance/security/tests after implementation | completed behavior | `pnpm check:docs` |

No file is deleted. “Reuse/modify only if needed” means Terra must first attempt composition with the current public props; do not change a renderer merely for stylistic uniformity.

## 28. Acceptance Criteria

**Vertical slice**

- An owner/analyst starts a local new conversation, sends a supported prompt, and exactly one conversation, user message, assistant placeholder and run are persisted.
- The run uses the existing queue/worker/DAG and frozen snapshot/config behavior.
- Real progress appears, then validated metrics/chart/evidence/report render from canonical artifacts.
- The assistant terminal message references the run/report/artifacts and the full thread survives reload.
- A contextual follow-up uses bounded prior messages/run refs and creates no duplicated conversation/system.

**Correctness and analytics boundary**

- All business values come from `@vda/semantic`; UI/model/tools calculate none.
- Null, abstain, missing data and insufficient peers remain explicit and are never rendered as zero/confidence.
- No arbitrary SQL, silent scope widening, unverified chart values, causal claims or invented references are possible through the schemas/tool registry.

**Lifecycle**

- Provider failure, run failure, validation failure and cancellation persist safe assistant terminal states.
- Retry/idempotency cannot duplicate turns/runs; current run retry limits remain.
- Stale worker fencing prevents terminal message changes as well as run changes.

**Security**

- Viewer cannot send/cancel; owner/analyst can.
- Workspace members can read their workspace conversation; other tenants cannot enumerate/read/mutate it through repository, API or direct Data API.
- Authenticated direct writes remain revoked; RLS tests and security checker pass.
- Client/model cannot assert authority; provider/DB secrets never cross the server boundary.

**UX/accessibility/performance**

- Conversation navigation, thread, rich results and composer fit the existing desktop/mobile shell.
- Keyboard input, focus, labels, dialog behavior and polite progress announcements are accessible.
- Conversation/message pages use keyset pagination and indexed predicates.
- Polling runs only for the active visible non-terminal run and stops cleanly.

## 29. Validation Commands

Run from repository root in this order. Inspect failures before continuing; do not use destructive production database commands.

```bash
git status --short
git diff --check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm db:start
pnpm exec supabase --workdir src/backend db diff
pnpm test:db
pnpm check:security
pnpm check:docs
pnpm test:e2e
git diff -- src/backend/packages/contracts/src/index.ts src/backend/packages/db src/backend/packages/agents src/backend/worker src/backend/supabase src/frontend docs
```

Notes:

- Generate the migration once at the schema phase with `db diff -f agent_chat`; the final validation command above omits `-f` and must report no remaining declarative-schema drift rather than creating another migration.
- `pnpm db:reset` is acceptable only for a disposable local Supabase stack when explicitly intended; never point it at production.
- If the full E2E provider requires the existing deterministic adapter/fixture, use the current Playwright configuration rather than real paid provider calls.
- Before any commit later requested by the user, review `git status`, full relevant diff, and stage only one logical functionality.

## 30. Known Limitations / Follow-ups

- The fixed analysis DAG produces the full inventory analysis; question-specific planning is limited to supported intent/focus and does not add new metrics.
- Context uses a bounded recent window and reference summaries; no long-term semantic memory or generated conversation summary exists in MVP.
- Conversation URL deep links, rename/archive/delete/search, private threads, attachments and branching are deferred.
- Viewer read-only conversational retrieval is deferred; MVP disables sending for viewers to preserve current write semantics without an ambiguous partial chat.
- Token streaming/SSE/WebSocket are deferred until measured polling/latency evidence justifies them.
- New sales/reservation/price-event/portfolio/causal prompts require semantic contracts, deterministic calculations, artifacts and tests before becoming suggested or routable.
- Provider telemetry is limited to safe operational metadata; a future privacy-reviewed observability design may add traces without raw sensitive prompts.

## 31. Exact Prompt for GPT-5.6 Terra

Use the following prompt verbatim when implementation is authorized:

```text
You are GPT-5.6 Terra acting as the implementation engineer for the VDaAgent repository.

Implement the complete Agent Chat feature described in:
docs/agent-chat-implementation-plan.md

The current working tree is the source of truth. Before editing:
1. Run git status, git diff, and git diff --cached.
2. Read the root/user AGENTS.md instructions and src/frontend/AGENTS.md completely.
3. Re-open the plan and inspect every referenced current file/symbol. If a path or symbol changed after the plan was written, follow the current implementation while preserving the plan's invariants; document any necessary deviation.

Work phase-by-phase in the exact dependency order in sections 26 and 27. Preserve all unrelated/uncommitted work. Use focused edits; do not reset, restore, clean, switch branches, commit, or push unless the user explicitly asks. Do not revive the deleted Python architecture.

Non-negotiable invariants:
- @vda/semantic remains the sole authority for business calculations.
- The LLM/UI/tools may not invent metrics, chart values, SQL, scope, permissions, IDs, evidence or factual claims.
- Keep one bounded orchestrator with at most one model-selected typed tool per turn.
- Reuse the existing PostgreSQL queue, worker, DAG, artifacts, reports, polling, cancellation, auth, repository authorization and RLS.
- Add no Redis/Kafka/BullMQ/new DB/vector DB/Python/xAI/LangChain/LangGraph/MCP/SSE/WebSocket/multi-agent infrastructure.
- Extend existing conversations/messages; do not create a parallel chat subsystem.
- Store canonical references in message parts, never copied analytic payloads or hidden chain-of-thought.
- Derive user/org/role server-side and re-authorize every tool execution; viewers cannot create or cancel analysis.
- Preserve workspace-shared conversation visibility and cross-tenant denial.
- Preserve lease/fencing, idempotency, snapshot pinning, validation and publication gates.

For database work, edit the declarative schema first, generate the migration with the Supabase CLI, review it, add only the required idempotent legacy DML backfill, and test RLS/grants. Do not invent a migration timestamp or run destructive commands against production.

For each phase:
- implement the listed files and Definition of Done;
- add/adjust the specified tests;
- run the smallest relevant validation immediately;
- inspect the relevant diff before proceeding.

Complete the vertical slice before optional polish: first turn persisted -> structured decision -> typed create_analysis -> existing worker/DAG -> real progress -> validated artifacts/report -> assistant finalized -> reload restored. Then cover follow-up, failure, cancellation, viewer and cross-tenant cases.

At the end run all commands in section 29 that apply. Report:
1. files changed by logical functionality,
2. architectural deviations and why,
3. validation results with exact commands,
4. remaining limitations from section 30.

Do not redesign the feature from scratch. Do not implement out-of-scope items. Do not claim completion while any required acceptance criterion or validation remains unresolved.
```

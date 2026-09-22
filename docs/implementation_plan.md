# VDaAgent target agent architecture: implementation plan

Status: planning only. Based on the repository at `main` on 2026-09-21. The current code and tests take precedence over older architecture notes. This document does not authorize a code or database deployment.

## 1. Goal and non-goals

Evolve the existing inventory workflow into a durable, evidence-first, use-case-driven agent workflow: Coordinator -> Data -> independent Comparison/Chart/Analyst -> Insight -> ReportDraft -> Reviewer -> deterministic publication gate -> FinalReport and shared chat. Deliver `slow_moving_inventory` end to end on the present provisional dataset, then make later use cases registrable.

Keep the existing PostgreSQL run queue, worker, semantic formulas, snapshot pinning, artifacts, report storage, Supabase Auth/Storage, and chat tables. Do not build another queue, unrestricted model SQL, a second analytics runtime, a free-running agent loop, or arbitrary user questions against warehouse tables. Do not silently claim portfolio, price-band, causal, or authoritative sales analytics that the present scope/data semantics do not support.

## 2. Current architecture summary

`src/frontend/src/server/api.ts` sends interactive analysis to `SqlRepository.createRun` directly or uses `AgentChatOrchestrator.submit` for a bounded model decision and one typed tool. Scheduled definitions call `SqlRepository.tick`/`occurrence` and enqueue the same run. `src/backend/worker/src/index.ts` claims one run and calls `executeLease` under a heartbeat. `src/backend/packages/agents/src/index.ts:23-32,253-417` executes one sequential DAG:

```text
interactive API / one chat decision / schedule
    -> run + pinned snapshots -> worker lease
    -> orchestrator -> data -> calculation -> comparison
    -> chart -> insight -> validation -> report -> completeRun
    -> report row + assistant reference message
```

The DAG `orchestrator`, `data`, `comparison`, `chart`, `insight`, `validation`, and `report` names are task labels. The chat decision provider is an LLM-backed routing boundary. The insight narrative provider chooses a constrained list of already bound claim IDs and a fixed safe summary; it is not an autonomous Analyst, Insight, Report, or Reviewer agent (`provider.ts:15-20,80-95,187-202`). Quantitative work lives in `@vda/semantic` and deterministic chart/integrity functions. `calculation` contains current metrics, history, breakdowns, candidate insights and quality limits; there is no named canonical `DataAnalysisPack`.

## 3. Target architecture

One server-owned `CoordinatorDecision` selects a registered use case, authorized scope, data date, and run/reuse action. One Data Agent boundary owns approved query templates and deterministic semantic execution, then persists a versioned `DataAnalysisPack`. Three independent branch contracts consume that pack: `ComparisonPack`, `ChartPack`, `AnalysisPack`. The Insight Agent joins all three. A Report Agent persists versioned drafts; a distinct Reviewer Agent assesses an existing draft. The deterministic validator checks the draft, review result, evidence, chart bindings, tenant/date/version, and publication preconditions. A bounded revision can create a new immutable draft. Only a passing review and validation create the final `report` artifact and `reports` row. Messages attribute each persisted contribution to a specialized agent while linking back to run/artifact IDs.

## 4. Architectural principles and invariants

- `@vda/semantic` remains the quantitative authority; Data Agent invokes it. Neither a downstream LLM nor the UI recomputes canonical metrics.
- The Data Agent is the only warehouse-read boundary for an analysis run. All downstream inputs refer to one pinned run/scope/date/semantic version.
- Every factual value in a pack, chart, finding, review, or report is traceable to immutable artifact paths and source/snapshot references; null and abstention remain explicit.
- Keep server-derived user/org/role, scoped repository queries, membership rechecks, RLS, private storage, idempotency, lease fencing, cancellation, and bounded retries.
- A task is not treated as an agent unless it has an identity, responsibility, typed input/output, and a persisted result. Deterministic substeps remain functions or tasks.
- Scheduled and interactive requests resolve to the same use-case workflow. A schedule can form a deterministic Coordinator decision without an LLM.
- No final `reports` row, export, or completed assistant report reference before review and validation pass.

## 5. Gap analysis

| Target | Current classification | Repository evidence / required change |
| --- | --- | --- |
| Coordinator Agent | PARTIALLY ALIGNED | `agents/src/chat.ts:201-370` routes one turn; `tools.ts:53-76` enqueues. Scheduler/API bypass it; `agents/src/index.ts:255-263` only stores a fixed plan. Add common typed decision and use-case resolution. |
| Data Agent | IMPLEMENTED DIFFERENTLY | `agents/src/index.ts:264-320` separates data and calculation tasks; `db/src/repository.ts:1205-1215` reads pinned snapshots. Wrap approved retrieval, metrics, quality, and lineage in one agent boundary. |
| Deterministic Data internals | PARTIALLY ALIGNED | `semantic/src/index.ts:68-96,154-297,877-947` and `registry.ts` own metric semantics; `agents/src/index.ts:326-335` still invokes peer computation in Comparison. Preserve formulas and move that invocation under Data. |
| DataAnalysisPack | NOT IMPLEMENTED | `contracts/src/index.ts:268-382,879-939` has calculation/query artifacts but no single pack contract. Add a versioned canonical pack referencing them. |
| Comparison Agent | PARTIALLY ALIGNED | `agents/src/index.ts:321-350` produces comparison artifacts, but calls `compare(selectLatest(query_result.rows))` outside Data. Consume precomputed numeric inputs from the pack. |
| Chart Agent | PARTIALLY ALIGNED | `chart-builder.ts:535-570` builds validated charts, but is a sequential task, dependent on Comparison. Separate chart selection/output contract; keep deterministic values. |
| Analyst Agent | NOT IMPLEMENTED | `semantic/src/index.ts:495-603` yields rule-based candidates; no distinct finding contract/stage. Add evidence-bound Analyst output. |
| Parallel fan-out/fan-in | NOT IMPLEMENTED | `agents/src/index.ts:23-32` orders comparison -> chart -> insight and has no analyst node. Make branch dependencies independent and join at Insight. |
| Insight Agent | IMPLEMENTED DIFFERENTLY | `agents/src/index.ts:359-376` binds deterministic claims and calls constrained narrative provider; it does not join three packs. |
| Report Agent | IMPLEMENTED DIFFERENTLY | `agents/src/index.ts:377-415` builds a report payload in `validation`, then the `report` task stores it; there is no distinct composer contract. |
| ReportDraft lifecycle | NOT IMPLEMENTED | No persisted draft/revision exists before publication; add immutable draft versions and explicit status. |
| Reviewer Agent | NOT IMPLEMENTED | No post-draft semantic review contract or provider call. |
| Technical validator | ALREADY ALIGNED | `domain/src/integrity.ts:130-292`, `chart-builder.ts:461-533`, and `db/src/repository.ts:1348-1384` enforce deterministic checks; extend for new packs/review. |
| Publication gate | PARTIALLY ALIGNED | `completeRun` requires valid artifacts and `validateReport`, but has no review result. |
| Specialized chat identity | NOT IMPLEMENTED | `contracts/src/index.ts:1079-1093` only stores `user`/`assistant`; UI `message-thread.tsx` has no agent sender. |
| Background workflow | ALREADY ALIGNED | `worker/src/index.ts:47-92` claims and executes queued runs on the server for the present use case. Deployment of an always-on worker must still be configured operationally. |
| Scheduler | ALREADY ALIGNED | `worker/src/index.ts:36-52`, `db/src/repository.ts:1580-1650` enqueue deduplicated occurrences for the present use case. |
| Use-case registry | NOT IMPLEMENTED | `semantic/src/registry.ts` is a **metric** registry, not a workflow/use-case registry; contracts and plan are inventory-specific. |
| Structured agent contracts | PARTIALLY ALIGNED | Zod run/artifact/chat schemas exist; target pack/decision/draft/review boundaries do not. |
| Evidence lineage | ALREADY ALIGNED | Artifact hashes, input/source/snapshot FKs and `domain/src/integrity.ts:130-292` validate current report lineage; extend to new packs. |
| Persistence | ALREADY ALIGNED | `db/src/repository.ts:1217-1271,1348-1420` persists immutable artifacts, validations and reports; extend to drafts/branches. |
| Retries/idempotency | ALREADY ALIGNED | `repository.ts:558-661,1112-1157` pins snapshots, deduplicates keys, caps attempts and fences workers; extend checkpoint/revision behavior. |
| Authorization/RLS | ALREADY ALIGNED | `repository.ts:189-205`, `supabase/schemas/001_inventory.sql:60-154`, `005_agent_chat.sql:31-39`; apply same model to new records. |
| Provider abstraction | PARTIALLY ALIGNED | `provider.ts:36-77,187-202,294-335` has decision/narrative interfaces and Gemini/OpenAI fallback; add role-specific typed responses. |
| Test coverage | PARTIALLY ALIGNED | Semantic/chart/pipeline/repository/RLS/e2e tests cover current behavior; no fan-out, draft/review, or agent contract tests. |

## 6. Exact files/modules likely to change

- `src/backend/packages/contracts/src/index.ts` and exported JSON schemas: new versioned decision/pack/draft/review types, task and sender identity, legacy parsing.
- `src/backend/packages/agents/src/index.ts`: split the current `executeLease` into stage runners while preserving its public entry point and existing report export. `chart-builder.ts`, `provider.ts`, `chat.ts`, `tools.ts`: adapt builders, typed providers, routing and tools.
- `src/backend/packages/domain/src/integrity.ts`: validate new artifact kinds, claim/reference graph, draft/review/publication; retain current `validateReport` for old reports.
- `src/backend/packages/semantic/src/index.ts` and `registry.ts`: expose deterministic precomputed comparison/analysis inputs, add only approved metric semantics. Avoid changing current formulas without a correctness test.
- `src/backend/packages/db/src/types.ts`, `repository.ts`: branch checkpoints, versioned artifact lookup, publication transaction, message identity, review retrieval and authorization.
- `src/backend/worker/src/index.ts`: call the evolved executor, keep run claim/heartbeat/tick; adjust terminal handling only where necessary.
- `src/backend/supabase/schemas/001_inventory.sql`, `005_agent_chat.sql`, a new additive declarative schema file, and a generated migration: artifact keys/revision and new message metadata/indexes. Preserve original schema files where possible; use a new schema file for additive changes.
- `src/frontend/src/server/api.ts`, `src/frontend/src/lib/client-api.ts`, `src/frontend/src/components/agent-chat/{agent-chat,message-thread,run-progress,composer}.tsx`, `src/frontend/src/components/analysis-result.tsx` as needed: use-case request, specialized sender, branch progress, draft/review state and authorized artifact hydration.
- Existing tests under `src/backend/tests`, `src/backend/packages/{agents,db}`, `src/backend/supabase/tests`, and frontend component tests.

## 7. New files/modules/contracts likely to be added

Prefer focused modules under `src/backend/packages/agents/src/`: `use-cases.ts` (registration and capabilities), `coordinator.ts`, `data-agent.ts`, `comparison-agent.ts`, `chart-agent.ts`, `analyst-agent.ts`, `insight-agent.ts`, `report-agent.ts`, `reviewer-agent.ts`, `workflow.ts` (dependencies/join), and `publication.ts` (gate). These modules define execution boundaries, not separate runtimes. Add corresponding Zod schemas in a small `contracts/src/agent-workflow.ts` and export them from `index.ts`. Add `semantic/src/slow-moving-inventory.ts` only if extracting the existing formulas can be done without formula changes. Add targeted contract and workflow tests next to the new modules. Exact names can be adjusted during implementation to fit package conventions, but ownership and inputs/outputs must stay explicit.

## 8. Database/schema changes

Keep `runs`, `tasks`, `artifacts`, `validations`, `reports`, `conversations`, and `messages`. The present `artifacts` constraint `UNIQUE(org_id,run_id,kind)` (`001_inventory.sql:13`) allows one artifact of each kind, so bounded draft revisions need a stable per-run `artifact_key`/revision slot. Add a non-null key, backfill old rows with `kind`, retain one canonical key per old artifact, replace the uniqueness constraint with `UNIQUE(org_id,run_id,artifact_key)`, and require `kind='report'` to keep the canonical `report` key. New keys can be `report_draft:1`, `review_result:1`, `report_draft:2`, `review_result:2`; never update an earlier payload. Version new artifact schemas and make `storeArtifact` look up the exact key, with a compatibility path for old kind-based reads. Verify FK references, immutable triggers, unique report row, and mixed old/new runs on a copied dataset before migration.

Add `messages.sender_agent` as a nullable, constrained field (legacy assistant reads as Coordinator/legacy assistant) and, only if needed, `messages.artifact_id`/`stage_key` indexes for attributable results. Keep message parts reference-only. Extend task persistence to address per-stage identity and attempts without weakening run fencing. Use declarative schemas (`config.toml:63`) first, generate/review the migration with the project CLI, add an idempotent backfill, and test fresh install plus upgrade. Every exposed table/column keeps RLS and explicit grants; new draft/review kinds need a narrower SELECT policy if they remain unpublished. The `reports` table stays the publication marker.

## 9. Agent identity and message model changes

Define stable `AgentKey = coordinator|data|comparison|chart|analyst|insight|report|reviewer`. A message retains `role=user|assistant` for compatibility, gains `sender_agent` for an assistant, and includes only typed run/artifact/draft/review references. A branch may emit a persisted agent message or an event linked to its pack; the UI must not present an unpersisted model response as canonical. Existing messages without a sender render with the current assistant label. Scheduled runs can create a shared scheduled conversation and attributed lifecycle messages. Enforce one terminal assistant message for the initiating turn; additional stage messages need separate, stable IDs and must not violate `messages_run_role_unique` (`005_agent_chat.sql:27-29`), which must be narrowed to the initiating assistant or replaced with an explicit message purpose key. Keep each message below the existing 32-part limit (`contracts/src/index.ts:1089`); use a run reference and authorized artifact hydration instead of appending every new artifact to one message.

## 10. Coordinator design

Implement `CoordinatorDecision` with use_case, org, authorized scope, requested/effective date policy, comparison windows, entrypoint, reuse/new-run choice, requested capability, and unsupported reason. Interactive routing can extend `AgentChatOrchestrator` and the existing structured decision provider; validate selected scope against the server catalog and role. Scheduled input uses a deterministic adapter from the definition snapshot, with no need for an LLM. Existing-result reuse must check same tenant, use case, scope, semantic version, source snapshot policy, and publication status. The Coordinator never emits SQL, numeric results, or report publication.

## 11. Data Agent design

Create one Data Agent runner whose deterministic internals perform approved template selection, pinned warehouse read, row/scope/date validation, semantic calculation, peer numeric inputs, data quality and lineage. Reuse `readSnapshots`, `getMetricConfig`, `selectLatest`, `analyze`, and `compare` from their present locations, but move the `compare(selectLatest(query_result.rows))` invocation at `agents/src/index.ts:326-335` into the Data boundary. The reasoning layer selects only registered input requirements/metric packages; it cannot author SQL. Freeze a pack from the same run snapshots and record threshold/semantic version. Keep raw snapshot rows in the existing query artifact, not in downstream prompts or chat.

## 12. DataAnalysisPack contract

Versioned schema with `run_id`, `org_id`, `use_case`, `scope`, requested/effective as-of date, semantic/schema versions, metric configuration, dataset row count, source/snapshot/input refs, current metrics, historical metric inputs, breakdowns, ranked unit refs, peer numeric inputs, quality metrics, limitations, evidence paths and content hash. It may reference existing `query_result` and `calculation` artifacts rather than copy all rows; downstream consumers receive a bounded resolved view. Each metric carries unit/currency/abstention and a canonical artifact/path. Validate same-run/same-date lineage and that every numeric field equals the existing deterministic output. Existing `calculation` artifacts remain readable for historical runs.

## 13. Comparison Agent design

Read only `DataAnalysisPack`; select and explain relevant 7/30/90-day and segment comparisons. The Data boundary precomputes absolute/percentage-point/relative deltas and peer values with current `@vda/semantic` rules. Emit `ComparisonPack` with exact source metric refs, ordered comparisons, rankings, notable changes and limitations. No warehouse call and no new arithmetic in an LLM. Keep current comparison artifact shape available to older report renderers through an adapter during migration.

## 14. Chart Agent design

Read `DataAnalysisPack` and only validated deterministic comparison **values included in the pack**, so the chart branch need not wait for Comparison Agent. Retain `ChartBuilder` and `validateVisualEvidence`; modify inputs to reference canonical numeric sources, then emit `ChartPack` with specs, rationales, bindings and unavailable-chart reasons. If a chart requires a Comparison Agent interpretation, it can be added at Insight/Report composition, but the numeric chart spec remains independent. Test value/path equality, empty/abstain cases, ordering and fingerprints.

## 15. Analyst Agent design

Consume the same pack and rule-generated candidate observations. Emit typed `AnalysisPack` findings with category, descriptive/interpretive flag, scope, supporting metric/path refs, support level, limitations, and candidate-driver wording. Permit only descriptive evidence-backed findings by default; causal claims require a separately approved use-case contract and evidence. An optional model may rank or phrase allowed candidates, but deterministic validation rejects invented facts, numbers, scope or missing references. Keep `semantic/src/index.ts:495-603` candidate rules as the first implementation input.

## 16. Parallel fan-out/fan-in execution design

After the pack is persisted/validated, mark Comparison, Chart and Analyst runnable with dependency `data_analysis_pack` only. Under the existing run lease, launch independent branch runners concurrently using isolated immutable inputs and separate task/artifact writes; never mutate a shared in-memory artifact map across branches. Await all three with explicit `allSettled` handling, persist each successful checkpoint, and join only when all required packs validate. On worker crash, the next fenced owner rehydrates valid branch artifacts and runs only missing branches. The existing one-worker-per-run model can achieve branch concurrency without a second queue; measure DB/provider load and cap branch concurrency. If later distributed stage leasing becomes necessary, extend the same PostgreSQL task rows with atomic claim/fencing rather than adding a second queue. Test simultaneous completion, one-branch failure, crash after one checkpoint, cancellation, and stale-owner denial.

## 17. Insight Agent design

Require the canonical pack plus all three branch packs. Deduplicate and rank findings, identify conflicting scope/date/value claims, and emit `InsightPack` whose every factual clause names canonical evidence. Keep the current provider's strict claim-ID discipline and fallback, but give the new role an output schema for selected candidate IDs, explanations and limitations; no free numeric prose. Reject unsupported or contradictory synthesis. A deterministic safe summary remains the provider-failure fallback only if it passes the same content gate.

## 18. ReportDraft and Report Agent design

Compose a `ReportDraft` from validated Data/Comparison/Chart/Analysis/Insight packs. Include title, sections, claims, charts, limitations, source refs, scope/date and revision number. Persist draft revision 1 before review; do not create a `report` artifact or `reports` row yet. The Report Agent may revise only issues named in a `ReviewResult`, creating draft revision 2 as a new immutable artifact. Reuse `reportSections` and existing report payload/export shape for the final compatibility adapter. Preserve the current `DecisionBrief` derived from calculation evidence.

## 19. Reviewer Agent design

Review an existing persisted draft, never the pre-draft inputs alone. Emit structured `ReviewResult` with `PASS|REVISION_REQUIRED`, per-claim findings, unsupported/overstated language, metric/prose and chart mismatches, inconsistent scope/date, contradiction, omitted limitations, and required corrections with evidence refs. Use a role-specific structured provider adapter and strict input/output bounds. The reviewer cannot rewrite metrics or approve an artifact with failed deterministic checks. Limit to two draft versions and two reviews; on second failure mark review blocked/failed and do not publish. Provider failure leaves a retryable checkpoint, not a pass.

## 20. Technical validator and publication gate design

Run deterministic schema/hash/lineage/tenant/date/version/chart/claim checks on every pack and draft; after reviewer PASS, validate the final draft and review result together. Extend `completeRun` so its single fenced transaction verifies a passing review for the exact draft hash/revision, every required artifact validation, unchanged canonical values, and current membership, then inserts final report, transitions run, and finalizes the initiating message. Keep legacy already-published reports readable/exportable without inventing retrospective review. A feature flag or workflow version lets old in-flight runs finish under their original gate during rollout; all newly opted-in runs require review. Never treat the existing pre-report `validation` task as semantic review.

## 21. Use-case registry design

Add a server-owned registry separate from `metricRegistry`: use-case key/version, allowed scopes, approved data requirements/query templates, semantic package, comparison windows, branch capabilities, report template, review policy, validator, and allowed tools. Resolve by key at enqueue and persist the resolved version/config with the run. Registration is code/config-reviewed, not user-defined prompts or SQL. Unknown or disabled capabilities return structured unsupported responses. The shared workflow executes a registry definition, while specialized semantics stay in each use-case package. Generalize the current inventory-specific `SEMANTIC_VERSION` literal and exact metric-set check (`contracts/src/index.ts:3,870`; `domain/src/integrity.ts:200-205`) through versioned per-use-case validators; keep the old inventory parser for historical artifacts.

## 22. `slow_moving_inventory` migration into the use-case framework

Register the present inventory flow as `slow_moving_inventory` with project/optional zone scope, threshold, 7/30/90 windows, existing metrics, four existing segment dimensions, chart rules, and provisional limitation. Map old runs with no use-case field to `slow_moving_inventory` at read time; avoid rewriting immutable old artifacts. Confirm actual snapshot fields (`contracts/src/index.ts:38-89`) and available warehouse mapping before adding price bands or portfolio project comparisons. Implement any new price-band/project metric only with approved deterministic semantics, lineage and tests; until then expose an explicit unsupported capability rather than fabricate results. E2E acceptance uses the existing synthetic source with visible provisional labeling.

## 23. Background worker/DAG changes

Keep `claimRun`, heartbeat, `executeLease`, `failRun`, three-attempt cap and run-level fencing. Add workflow-version dispatch so old/in-flight runs use the old DAG and new runs use Coordinator/Data/fan-out/Insight/ReportDraft/Reviewer/validation/publication. Persist task dependencies and status before/after execution and use stable task IDs. Recover from persisted artifacts and avoid replaying completed model stages. A retry must not overwrite a previously persisted draft/review with different content; version and hash each output. Retain cancellation checks at every stage and immediately before publication.

## 24. Scheduler compatibility

`SqlRepository.tick` and occurrences remain the scheduler entrypoint. Translate a definition snapshot into the same `CoordinatorDecision`, preserve scheduled-date/previous-day policy, occurrence uniqueness, pinned definition version and idempotency key (`repository.ts:1580-1650`). Scheduled runs create the same pack/review/report chain. Document worker process deployment and scheduling cadence; the current repository shows a worker/tick executable, not proof of a deployed always-on cloud service.

## 25. Group-chat changes

Show Coordinator/Data/Comparison/Chart/Analyst/Insight/Report/Reviewer sender names, status and artifact references in the shared thread; render canonical content from authorized APIs. Add explicit `@Agent` target selection to turn contract/UI. Route only supported follow-up actions from a capability registry: Analyst evidence explanation, Comparison existing validated dimensions, Chart validated visualization, Report draft revision request where a reviewable draft exists. A follow-up requesting new numeric scope/date should create a new run or a registered extension, never mutate a published report or silently query data. Keep bounded context, one typed tool per turn, workspace visibility and viewer read-only policy unless a separately approved read-only interaction is added.

## 26. API changes

Extend create-analysis/chat request schemas with optional use-case and agent target while defaulting old clients to `slow_moving_inventory`. Add authorized GET endpoints for stage packs, draft/review status and attributable messages, or extend `GET /runs/:id/artifacts` with safe typed views. Keep current `/analyses`, `/runs`, `/conversations`, `/reports` response shapes or version them explicitly. A final report endpoint must return only published reports; draft endpoints must check membership and role. Preserve `Idempotency-Key`, body limits, same-origin mutation guard and `no-store` handling in `server/api.ts`.

## 27. Repository/persistence changes

Add repository methods for exact artifact-key lookup, branch checkpoint, review/draft retrieval, attributed stage message insert, and atomic publish. All methods take org/run context and enforce server authorization/fencing. Preserve `buildRun` idempotency and `run_snapshots`, `storeArtifact` immutability, source/snapshot join tables, `finalizeRunAssistant` terminal atomicity and report uniqueness. Use transactionally guarded task dependency state; workers re-read canonical persisted inputs rather than trusting mutable process state.

## 28. Provider/model abstraction changes

Retain `NarrativeProvider`/`AgentDecisionProvider` Gemini-primary/OpenAI-fallback wiring. Introduce small role-specific interfaces with versioned Zod outputs (Coordinator, Analyst, Insight, Reviewer and optional Report wording). Send only bounded evidence summaries/IDs, never raw warehouse rows, auth secrets or unrestricted tools. Record provider/model/schema version and safe error code in stage metadata. Distinguish provider transport failure from schema rejection and semantic validation failure. Deterministic branches require no model call.

## 29. Security/RLS/authorization considerations

New columns/tables in exposed schema need RLS, scoped SELECT policies and explicit grants; authenticated users remain unable to write directly. Never authorize from user-editable JWT metadata. `service_role`/DB credentials stay server-side. Validate org/run/actor on every reference and prevent cross-run evidence substitution. Reviewer output is untrusted model output until schema and deterministic gates pass. Drafts may contain unpublished findings: default to owner/analyst reads and enforce this in the `artifacts` RLS SELECT predicate for new draft/review kinds as well as the repository/API, while keeping old published artifacts workspace-readable. Test same-workspace, other-workspace and revoked-member access through repository, API and direct Data API.

## 30. Evidence/lineage guarantees

Preserve artifact content hashes, input refs, snapshot refs, source refs and FK joins. Each new pack includes `run_id`, org, use case, scope, date and semantic version; all referenced inputs must share them. Comparison/chart/analysis/insight/report claims bind to canonical pack paths. Reject dangling, circular, cross-run, wrong-value or wrong-currency refs. On publication, revalidate the entire graph including the exact reviewed draft and its revisions. Keep raw data provenance inside artifacts and authorized evidence views, not copied message prose.

## 31. Idempotency/retry/cancellation behavior

Use stable `run_id:stage:revision` task/artifact/message keys. An idempotent retry returns the prior artifact if hash matches; differing content at the same key is a conflict. A new worker resumes successful branches and bounded review version state. Recheck fencing on every write and on the final transaction. Cancellation turns pending/running tasks terminal, denies publication and finalizes the initiating assistant as cancelled. Keep max run attempts three and max report revisions two as separate limits.

## 32. Failure handling

Missing source data produces explicit abstentions/limitations where existing semantics allow; invalid tenant/scope/lineage fails closed. A failed branch blocks fan-in but preserves successful checkpoint artifacts. Provider timeout/fallback exhaustion leaves a retryable stage error; malformed or unsupported claims fail validation. Reviewer `REVISION_REQUIRED` creates a bounded correction; no PASS at the limit yields failed/review-required run with no published report. Log stage/run IDs and safe codes without raw prompts, rows, provider secrets or unpublished report text.

## 33. Migration/backward compatibility

Deploy additive contracts/readers first; preserve parsing of old `calculation`, `comparison`, `visual_evidence`, `insight`, `report` and messages with no agent sender. Add schema and backfill `artifact_key=kind`, then deploy writers behind a workflow-version flag. Old running/queued runs finish via the old executor; new runs opt into the new gate only after compatible worker/API versions are live. No migration should mark historical reports as reviewer-approved. Test fresh and upgraded databases, mixed-version reads, rollback to old writer while the flag is off, and a forward-only data migration contingency once new artifacts exist. Roll back application flag/code first; retain additive columns/artifacts and never drop or rewrite user reports during emergency rollback.

## 34. Testing strategy

Keep existing semantic, chart, repository, pipeline, RLS, UI and e2e suites green for legacy paths. Add focused new tests at each phase; use deterministic provider fixtures for agent contract tests and a real embedded PostgreSQL repository for worker/publication behavior. Use local Supabase pgTAP for RLS/grants and local Playwright for the complete inventory flow. Do not treat mocked authorization or mocked lineage as sufficient integration evidence.

## 35. Unit tests

Cover Coordinator scope/date/use-case resolution, Data pack construction and abstention, deterministic comparison values, chart bindings, Analyst finding evidence, Insight dedup/conflict handling, draft composition, review decision parsing and bounded correction. Preserve numerical oracle tests in `tests/unit/semantic.test.ts` and chart tests in `tests/unit/chart-builder.test.ts`; add tests only for changed behavior.

## 36. Integration tests

Extend `tests/unit/postgres-pipeline.test.ts`, `packages/db/src/repository.test.ts` and `tests/unit/pipeline.test.ts` for run creation, frozen snapshots, artifact-key uniqueness, checkpoint resume, schedule parity, final publication transaction and legacy report reads. Exercise actual repository/fencing rather than replacing it with a fake in the critical path.

## 37. E2E tests

Extend `tests/e2e/mvp.spec.ts`: an owner starts a slow-moving analysis from chat, sees three branch states and attributable messages, opens grounded chart/evidence, sees a persisted reviewed report after reload, and follows up via `@Analyst`, `@Comparison`, `@Chart`. Verify unsupported capability responses, a scheduled occurrence using the same workflow, viewer read-only rendering and cancellation. Existing `/analyses` and report export flows remain functional.

## 38. RLS/security tests

Extend `supabase/tests/tenant_rls.test.sql` and `packages/db/src/postgres-schema.test.ts` for new draft/review/artifact/message records: tenant isolation, direct authenticated write denial, same-workspace reads, revoked membership, cross-run source FK and private draft access. Check schema grants and indexes with `scripts/check-security.ts`. Inspect policy effects on both SELECT and UPDATE paths before rollout.

## 39. Agent contract tests

Test each Zod contract against unknown keys, wrong use case, run/org/scope/date/version mismatch, missing evidence, noncanonical values, impossible reviewer PASS and invalid revision. Test provider fallback with the same bounded input and reject hallucinated claim IDs. Legacy artifact/message decoding remains explicit and versioned.

## 40. Parallel execution tests

Use barriers to prove Comparison, Chart and Analyst can begin after the pack without waiting on one another. Force one branch failure after another persists; reclaim the run and assert only missing work repeats. Test concurrent stage writes, cancelled run, expired lease, changed fencing token, dependency rejection and exactly one fan-in/Insight execution.

## 41. Reviewer/report publication tests

Create draft 1 -> REVIEW_REQUIRED -> draft 2 -> PASS -> deterministic validation -> one report row. Also test unsupported numeric/causal prose, chart mismatch, omitted limitation, wrong draft hash, provider failure, second rejection, cancellation and stale worker: all must leave zero published reports. Confirm old reports are still readable/exportable, and final assistant message is committed with the report row.

## 42. Observability/logging

Keep JSON worker logs and persisted task events. Add run/workflow/use-case/stage/revision, attempt, artifact IDs/hashes, elapsed time, provider class, review outcome and safe failure code. Expose branch and review progress via the current polling UI. Record metrics for queue lag, branch duration, retry count, review revision rate, provider failure and publication denial. Avoid raw data/prompt logging.

## 43. Performance considerations

Bound Data pack size and model context; pass references/summaries rather than snapshot rows. Reuse the pinned read and deterministic calculations; do not issue three branch warehouse queries. Cap per-run parallelism at three branches and provider concurrency separately. Review indexes for queue claims, `(org_id,run_id,artifact_key)`, task progress, conversation pagination and draft/review lookup. Measure P95 run and review latency before scaling workers. Retain query row/time limits and safe chart cardinality limits.

## 44. Rollout phases

Phase A contracts/use-case compatibility -> B schema/repository/legacy reads -> C Coordinator/Data pack -> D independent branch packs and fan-out -> E Insight/ReportDraft -> F Reviewer/publication gate -> G chat/API/UX -> H full migration validation and opt-in. Each phase depends on the preceding phase; later contracts may be drafted earlier, but no producer is enabled before its consumer/validator and migration are deployed. Keep the old workflow flag available until all existing queued runs drain. See ordered steps and gates below.

## 45. Detailed ordered implementation steps

| Phase | Implementation steps in order | Existing behavior and rollback | Required acceptance gate |
| --- | --- | --- | --- |
| A | Add versioned schemas and `slow_moving_inventory` registration; default old requests/runs to it; preserve old contract exports. | No runtime switch; revert new routing only. | Old contract/semantic tests pass; unknown use case rejected. |
| B | Add declarative schema/backfill/migration, repository keyed artifact and sender methods, new RLS/indexes; deploy dual readers. | Flag stays off; old `kind` keys and message labels work. Roll back writer, retain additive schema. | Fresh/upgrade PGlite and local Supabase tests pass; old report/export/chat reads identical. |
| C | Add Coordinator adapters and Data Agent; persist/validate canonical pack from pinned snapshots and existing semantic functions. | Old executor remains selectable; compare pack against old calculation fixture/oracle. | Interactive/scheduled same pack; scope/date/version and lineage match; no model SQL. |
| D | Move peer numeric calculation under Data; add Comparison/Chart/Analyst typed runners; execute independent branches and durable join. | Preserve old comparison/chart output adapter; flag off if concurrency fails. | Concurrency/reclaim/cancel/fence tests and chart/metric oracle pass. |
| E | Add Insight join, Report Agent and immutable draft revisions; keep final report serializer compatible. | No new publication yet; old report path retained. | Draft references all required packs; legacy report renderer/export contract still parses final adapter. |
| F | Add Reviewer provider, bounded revision, deterministic review validator and atomic publication gate. | Gate only new workflow version; legacy published reports unaffected. Disable new-run flag on failure. | PASS required for exact draft; all rejection/timeout/limit tests leave no report row. |
| G | Add attributed stage messages, @agent routing, API status/draft endpoints and UI rendering. | Old assistant messages/default routes still render. | Reload, viewer/tenant denial, supported follow-up, cancellation and scheduled UI tests pass. |
| H | Run full unit/integration/RLS/e2e/security checks, audit perf/logs, opt new runs in gradually, drain old queue. | Turn off opt-in for new runs; retain all persisted artifacts/reports. | Complete DoD below plus observed no duplicate publication or tenant leakage. |

## 46. Acceptance criteria for every phase

Each phase must supply exact changed-file review, versioned schema/contract examples, passing focused tests, and an upgrade/rollback note before the next phase begins. A schema phase additionally needs reviewed migration diff, RLS/grants and fresh/upgrade DB tests. An agent phase needs input/output schema validation, evidence checks, idempotent replay and provider failure behavior. A worker phase needs crash/cancel/fencing proof. A UI phase needs authorized reload and legacy rendering. Do not replace current semantic outputs merely to match new naming.

Concrete `slow_moving_inventory` acceptance: for a fixed synthetic fixture, current and 7/30/90 values, age threshold, unknown-age/price coverage, scope and snapshot selection match existing oracle tests; three branch packs share one canonical pack ID; every chart point and report claim resolves to canonical evidence; an unsupported project-wide/price-band/causal question abstains until approved semantics exist; the published report has a reviewed draft hash and passing technical validation; a failed review creates no report; scheduled and interactive runs produce equivalent analytic values; cross-tenant access is denied.

## 47. Definition of done

- Both entrypoints resolve a supported, versioned use case into the same durable workflow; execution runs on a deployed server-side worker independent of the user's device.
- One Data Agent boundary owns approved warehouse reads and deterministic numeric calculation and emits one canonical DataAnalysisPack per run.
- Comparison, Chart and Analyst have distinct typed/persisted outputs, consume that pack, and demonstrably run independently/concurrently; Insight joins all three.
- ReportDraft exists before Reviewer; revisions are bounded; semantic PASS and deterministic gates precede final `report`/`reports` publication.
- Specialized identities and evidence references survive reload in shared group chat; supported @agent follow-ups work without bypassing authorization or canonical data.
- Snapshot pinning, lineage, null/abstain, idempotency, retry, lease/fencing, cancellation, RLS, private storage and old report readability remain intact.
- The slow-moving inventory acceptance tests and full relevant test/security/e2e suites pass, with measured queue/branch/review behavior and documented rollback.

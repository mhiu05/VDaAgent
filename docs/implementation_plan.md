# Decision Intelligence Product Contract — Repository-Aware Implementation Plan

Review date: 2026-09-22
Repository: VDaAgent
Implementation target: Terra

## 1. Recommended outcome

VDaAgent should evolve its existing `DecisionBrief` rather than replace it, and should persist a new, first-class `decision_intelligence_pack` artifact containing:

- `DecisionBrief v2`
- `VisualStory v1`
- `PriorityEntity[]`
- `ActionCandidate[]`
- `DrillDown[]`
- explicit handoff completeness, evidence, metric, scope, snapshot, version, and limitation metadata

The pack should be built deterministically at the end of the existing Insight task, after `InsightPack` is available and before `ReportDraft` is created. It should not be a new agent, a new queue task, or a second runtime. The existing `insight` task remains the checkpoint owner and persists both `insight_pack` and `decision_intelligence_pack` with separate artifact keys.

The existing Report Agent, Reviewer, publication validator, report UI, and Agent Chat should consume this artifact instead of independently reconstructing decision semantics. `ReportPayload.decision_brief` should remain as a backward-compatible projection for existing report consumers, but the new pack must be the canonical source for newly produced runs.

No database migration is required. The existing JSONB artifact store, free-text artifact `kind`, per-run `artifact_key` uniqueness, lineage columns, immutability triggers, and artifact validations are sufficient. This change requires contract, builder, validator, orchestration, API, and UI work only.

Expected user-facing result:

> A Sales Operations user opens a completed run and immediately sees a compact, evidence-backed decision brief: current KPIs, material movements, the main concentration, two or three primary visuals, ranked entities to inspect, bounded next-action candidates, and drill-down links that preserve the original run, scope, date, semantic version, authorization, and evidence lineage. The detailed report and evidence remain available beneath that decision layer. Agent Chat uses exactly the same artifact.

## 2. Non-negotiable design constraints

The implementation must preserve the repository's evidence-first boundaries:

1. `@vda/semantic` and Data Agent remain the sole canonical numeric calculation boundary.
2. LLM providers may select or phrase only bounded, already-supported content. They must not calculate KPIs, deltas, rankings, materiality, contribution, or chart values.
3. Comparison, priority, action eligibility, and drill-down eligibility must be deterministic and configuration-driven.
4. Every numeric display must resolve to a canonical metric/evidence path from the same run and scope.
5. A new decision pack must not read a different snapshot or silently broaden/narrow scope.
6. Generic contract/runtime code must not contain slow-moving-inventory conditionals. Slow-moving rules belong in the use-case definition/policy registry.
7. Reviewer semantic checks and deterministic publication validation remain separate.
8. New runs fail closed when their decision artifact is invalid. Historical runs without it continue to render.
9. Existing `agent-v1` retries, leases, fencing, idempotent artifact writes, and maximum two draft/review attempts remain unchanged.
10. Do not add unrestricted SQL, autonomous business actions, unbounded agent loops, a new worker, or a second queue.

## 3. Repository state observed during review

The required pre-review checks were run:

- `git status --short --branch`: branch `main` tracks `origin/main`.
- `docs/implementation_plan.md` was already modified and contained an earlier draft of this review.
- `docs/architecture/` was untracked and was treated as unrelated user/team work.
- `git diff --stat` and `git diff -- docs/implementation_plan.md` were inspected before editing. No implementation file was modified.

This document intentionally supersedes the earlier draft at the requested deliverable path. The untracked architecture material and all implementation files remain untouched.

## 4. Actual runtime flow today

### 4.1 Agent workflow

`agent-v1` currently runs this bounded DAG:

```text
POST /api/v1/analyses
or AgentChatOrchestrator.submit(...)
or scheduler occurrence
  → SqlRepository.buildRun(...)
      src/backend/packages/db/src/repository.ts
  → worker claimRun(...)
      src/backend/worker/src/index.ts
  → executeAgentWorkflow(...)
      src/backend/packages/agents/src/agent-workflow.ts
  → coordinateRun(...) + Data Agent
      src/backend/packages/agents/src/coordinator.ts
      src/backend/packages/agents/src/data-agent.ts
      persists analysis_request, coordinator_decision, query,
      query_result, calculation, comparison_calculation,
      comparison compatibility artifact, data_analysis_pack
  → executeIndependentBranches(...) via Promise.allSettled
      src/backend/packages/agents/src/branch-workflow.ts
      ├─ buildComparisonPack(...)
      ├─ buildChartPack(...)
      └─ buildAnalysisPack(...)
  → executeInsightStage(...)
      src/backend/packages/agents/src/draft-workflow.ts
      persists insight + insight_pack
  → executeReportDraftStage(...)
      src/backend/packages/agents/src/draft-workflow.ts
      persists report_draft
  → reviewer stage
      src/backend/packages/agents/src/review-workflow.ts
      persists review_result
  → executePublicationStage(...)
      src/backend/packages/agents/src/publication.ts
  → SqlRepository.publishReviewedDraft(...)
      src/backend/packages/db/src/repository.ts
      atomically persists final report + report record
  → GET /api/v1/reports/:id and GET /api/v1/runs/:id/brief
      src/frontend/src/server/api.ts
  → Workspace / AgentChat / AnalysisResult / ChartRenderer
      src/frontend/src/components/workspace.tsx
      src/frontend/src/components/agent-chat/agent-chat.tsx
      src/frontend/src/components/analysis-result.tsx
      src/frontend/src/components/chart-renderer.tsx
```

`AGENT_WORKFLOW_DAG` in `src/backend/packages/agents/src/workflow.ts` is:

```text
coordinator
  → data
      → comparison ─┐
      → chart ──────┼→ insight → report → reviewer → publication
      → analyst ────┘
```

The worker dispatches based on the workflow version pinned on the run:

- `agent-v1` → `executeAgentWorkflow`
- `legacy-v1` → `executeLease`

The new decision artifact should be inserted without changing the task DAG:

```text
... comparison/chart/analyst
  → insight + insight_pack
  → deterministic decision_intelligence_pack   ← new artifact boundary
  → report_draft
  → reviewer
  → technical publication validation
  → final report
```

### 4.2 Current persistence and authorization flow

`SqlRepository.storeArtifact` validates the Zod artifact union, content hash, scope, lineage, and keyed idempotency before storing an immutable artifact. `supabase/schemas/006_agent_workflow_persistence.sql`:

- adds `artifact_key`;
- makes `(org_id, run_id, artifact_key)` unique;
- leaves `kind` as text rather than a database enum;
- retains JSONB payload storage;
- applies row-level security and immutability controls.

`SqlRepository.auth` verifies server-side organization membership. Artifact and run reads are scoped by `org_id` and `run_id`. `artifactByKey` additionally hides private `report_draft` and `review_result` artifacts from viewers. The new decision artifact is publication-facing and should have the same viewer visibility as `report`, `chart_pack`, and `insight_pack`, not the restricted draft/review visibility.

`claimRun` provides bounded attempts, lease ownership, and fencing. `publishReviewedDraft` re-reads persisted artifacts and validations and publishes atomically only after a matching PASS review. These mechanisms should be reused unchanged.

## 5. Findings against the 30 review questions

### 5.1 Contracts, semantics, and current signals

1. **Current canonical artifact contracts.**
   `src/backend/packages/contracts/src/index.ts` defines the discriminated `ArtifactSchema` and typed payloads. The quantitative source is `calculation`/`CalculationPayloadSchema`, with `DataAnalysisPackSchema` as the agent-workflow handoff. `ComparisonPackSchema`, `ChartPackSchema`, `AnalysisPackSchema`, `InsightPackSchema`, `ReportDraftSchema`, `ReviewResultSchema`, and final `ReportPayloadSchema` form the downstream chain.

2. **Existing slim brief.**
   Yes. `DecisionBriefSchema` and `buildDecisionBrief` already exist. The current `decision-brief-v1` includes scope, requested/effective dates, current-state signals, material changes, one “where to look” concentration, data-quality signals, two hard-coded actions, and limitations. It is embedded as optional `ReportPayload.decision_brief` rather than persisted independently. This contract should be versioned and evolved, not replaced with a parallel “summary” model.

3. **Shared schemas and versioning.**
   `src/backend/packages/contracts/src/index.ts` owns `SEMANTIC_VERSION`, `ARTIFACT_SCHEMA_VERSION`, `USE_CASE_CONTRACT_VERSION`, all Zod schemas, and inferred TypeScript types. `src/backend/packages/contracts/src/export.ts` generates JSON Schemas into `src/backend/packages/contracts/schema/*.json`. Pack-level versions are literal `contract_version` fields.

4. **Scope, refs, snapshots, and limitations.**
   `ScopeSchema` currently supports required `project` and optional `zone`. `WorkflowPackMetadataSchema` contains `run_id`, `org_id`, use-case/version, scope, `data_as_of`, semantic version, input/snapshot/source refs, and limitations. `CanonicalEvidenceRefSchema` contains artifact ID/key/path. `ChartProvenanceBindingSchema` and chart provenance bind displayed values to source paths. `DecisionEvidenceRefSchema` is a smaller role-aware ref used by the current brief. Limitations appear on artifacts, packs, signals, charts, findings, report sections, and the report. There is no reusable canonical metric-ref type and no explicit handoff completeness object yet.

5. **Slow-moving semantic definition.**
   The use-case registry is `src/backend/packages/agents/src/use-cases.ts`; `slowMovingInventory` defines the current scope policy, comparison windows, fields, dimensions, capabilities, version, and provisional limitation. Quantitative metric definitions are in `src/backend/packages/semantic/src/registry.ts`, and calculation/materiality/candidate logic is in `src/backend/packages/semantic/src/index.ts`.

6. **Existing registry/policy mechanism.**
   There is a typed use-case registry, but `UseCaseDefinitionSchema` lacks materiality, priority, action, visualization, and audience policies. Current `notableChangeRules` and `insightPriorityRules` are hard-coded in `@vda/semantic`. The registry should be extended and made accessible below the Agents package so domain validation and Data execution share the same canonical policy.

7. **Decision signals available deterministically today.**
   Current snapshots/history support:

   - total and available inventory;
   - available-inventory rate;
   - median and p75 inventory age;
   - slow-moving units/rate and configured age buckets;
   - 7/30/90-day period comparisons when snapshots exist;
   - concentrations by zone, unit type, bedrooms, and status;
   - unit-level age, availability, status, price, price/area, and slow-moving classification;
   - peer price/area gaps where comparable peers exist;
   - missing age/price/area rates and snapshot coverage;
   - deterministic ranking by supported current values and, after a bounded enrichment, additive contribution to inventory change.

8. **Signals requiring future warehouse fields.**
   Keep optional/unavailable until modeled:

   - leads, inquiries, views, visits, and demand trend;
   - funnel conversion, reservation, cancellation, and transaction velocity;
   - sales owner/activity/follow-up history;
   - pricing-change history, discount chronology, and days since price change;
   - causal driver validation;
   - cross-project portfolio ranking when the run is scoped to one project;
   - policy-approved price-band semantics. Current price can be bucketed technically, but no canonical business band policy exists.

9. **Comparison capabilities.**
   `CalculationPayloadSchema` and the private `buildPeriodComparisons`/`detectChanges` functions in `src/backend/packages/semantic/src/index.ts` already provide current/comparison values, absolute/relative/percentage-point deltas, snapshot refs, abstention reasons, and material/watch classification through `notable_changes`. `ComparisonPack` currently projects this data exactly. It does not expose explicit comparability status, rank, contribution-to-total-change, or temporal segment contribution. Current `segment_comparisons` compare segments against a reference segment, not each segment’s contribution to period movement.

10. **Chart semantics.**
    `ChartSpecSchema` supports intent, type, title, subtitle, free-text purpose, axes, series, deterministic data, provenance/bindings, and limitations. `buildChartPack` and chart integrity checks prevent invented values. It does not yet support typed purpose, takeaway, primary/supporting role, highlighted entities, annotations, reference lines, comparison context, display priority, or drill-down IDs.

11. **Analyst descriptive vs interpretive output.**
    `AnalysisFindingSchema.kind` already distinguishes `descriptive` and `interpretive` and carries support level/evidence/limitations. The current `analyst-agent.ts` emits only deterministic descriptive findings. This is a sound boundary. Candidate-driver statements may be added later only as explicitly qualified `interpretive` findings with bounded evidence and `limited`/`medium` support.

12. **Compact Insight synthesis.**
    `InsightPackSchema` already provides a compact summary, exact claims, selected finding IDs, evidence refs, limitations, and provider. The provider adapter is deliberately constrained and cannot change canonical claim values. It is a useful input, but it is not a complete decision artifact: it lacks materiality structure, priority entities, actions, visual story, drill-down, and handoff status.

### 5.2 Report, review, persistence, API, and UI

13. **Current ReportDraft.**
    `ReportDraftSchema` references Data, Comparison, Chart, Analysis, and Insight packs, carries revision 1–2, embeds the complete structured `ReportPayload`, and has evidence refs. It does not reference a decision pack.

14. **Report output format.**
    Report output is structured JSON, not Markdown or HTML. `ReportPayloadSchema` carries summary, claims, metrics, units, artifact IDs, typed report sections, limitations, and optional embedded DecisionBrief. React components render it; exports produce JSON/CSV.

15. **First-class insertion point.**
    Persist `decision_intelligence_pack` after `InsightPack` and before `ReportDraft`. This is the smallest stable boundary because all deterministic branch results and bounded Insight synthesis exist there, while Report has not yet duplicated presentation semantics. The ReportDraft should reference it, and the final report should carry its artifact ID plus a compatibility projection of its brief.

16. **Existing publication validation.**
    `validateReport` in `src/backend/packages/domain/src/integrity.ts` validates lineage, exact metrics/units, claim grounding, chart values/bindings, comparison and insight references, report sections, and the optional current brief. `validateAgentPublication` in `src/backend/packages/domain/src/agent-workflow.ts` validates the whole persisted agent graph, artifact keys, metadata, review binding, and final report. `publishReviewedDraft` performs this again inside the publication transaction.

17. **Reviewer semantics today.**
    `reviewer-agent.ts` and `review-workflow.ts` currently rehydrate the persisted graph and deterministically rerun Data, Comparison, Chart, Analysis, Insight, ReportDraft, lineage, scope/date, metric, chart, and limitation checks. The optional provider boundary can request only the single `REQUIRE_EVIDENCE_BOUND_WORDING` correction and cannot independently PASS or rewrite content. Although `ReviewIssueSchema` lists contradiction, overstatement, and limitation categories, there is not yet a general semantic review implementation for those categories, nor decision-readiness checks for materiality, priority, actions, visual takeaway, drill-down, or audience suitability.

18. **Deterministic vs semantic decision-readiness checks.**
    Deterministic checks must cover schema/version validity, ref resolution, exact values, same org/run/scope/date/version, chart integrity, priority-policy ordering, action allowlist, support thresholds, drill-down filters/targets, handoff completeness, and cross-run/cross-tenant rejection. Semantic review should cover whether the headline and implications are supported, materiality is not overstated, candidate drivers are qualified, action language matches support, takeaways match visuals, important limitations are prominent, and the result is useful to Sales Operations.

19. **Artifact persistence/versioning.**
    Artifacts are immutable JSONB records with `schema_version`, `semantic_version`, `data_as_of`, input/snapshot/source refs, content hash, org/run/task IDs, and typed payload contract versions. Agent artifacts additionally have stable `artifact_key` slots. This is sufficient for a new artifact.

20. **Can a new artifact type be added without migration?**
    Yes. `artifacts.kind` is text and payload is JSONB. `006_agent_workflow_persistence.sql` keys artifacts by `artifact_key` rather than a closed database enum. Add the Zod union member, expected-key mapping, repository/domain validation, and writers/readers. No table, index, trigger, RLS, or enum change is required.

21. **Migration decision.**
    No DB migration. Add one only if product requirements later demand a separately indexed/queryable decision entity outside the artifact model. That is not needed for the first implementation and would duplicate existing lineage and authorization.

22. **Report fetch path.**
    `GET /api/v1/reports/:id` in `src/frontend/src/server/api.ts` calls repository report lookup and returns `ReportDetailSchema`. `workspace.tsx` fetches the final report and, for details/evidence, the run artifact bundle.

23. **Agent Chat artifact loading.**
    `AgentChat` first fetches `GET /runs/:id/brief` after run success. It lazily loads `GET /runs/:id/artifacts` only when detailed artifacts/evidence are needed. Server-side `AgentChatOrchestrator` and tools load authorized run artifacts and current brief through the repository. Agent-target follow-ups are routed by `tools.ts`.

24. **Existing lazy loading.**
    Yes. The brief-first/full-artifacts-later pattern already exists in `agent-chat.tsx` and `workspace.tsx`. The new API should preserve it by returning a compact decision pack response whose components contain refs rather than duplicated full unit/chart datasets.

25. **API exposure.**
    Add canonical `GET /api/v1/runs/:id/decision-intelligence` returning a typed `DecisionIntelligenceResponse`. Keep `GET /api/v1/runs/:id/brief` and `DecisionBriefResponseSchema` byte-compatible with v1 consumers: for a new run it returns the pack’s deterministic v1 compatibility projection, and for an old run it returns the embedded v1 brief. The new endpoint carries `DecisionBriefV2` and the other four components. Both routes must use repository authorization and existing `private, no-store` response headers.

26. **Historical reports.**
    Historical reports without any brief remain readable as today. Historical reports with `decision-brief-v1` render through the existing component or a compatibility adapter. The new endpoint may synthesize a non-persisted, explicitly `legacy_report_brief` response with empty/unavailable new sections; it must never rebuild old metrics using a newer semantic version.

27. **Drill-down ownership.**
    The intent and immutable context belong in typed artifact `DrillDown` objects. Server resolution/authorization belongs in the existing API/repository layer. Rendering and tab/filter selection belong in `workspace.tsx`/`AgentChat` route state. Reuse existing `signal_ref`/`signal_action` and evidence-drawer concepts, but do not treat the current two-value `signal_action` enum as the full navigation model. Do not store opaque frontend URLs as canonical drill-downs.

28. **Run states, retry, idempotency, and leases.**
    Because the pack is a second keyed output of the existing Insight task, no task graph or scheduler change is needed. The Insight checkpoint succeeds only after both `insight_pack` and `decision_intelligence_pack` are valid and stored. On retry, stable artifact keys and content-hash idempotency return the same records; conflicting recomputation fails. Lease/fencing checks already wrap stage writes. Report waits on the existing Insight predecessor.

29. **Tenant/workspace protection.**
    `SqlRepository.auth` verifies org membership server-side; run/artifact/report queries bind org and run; viewer write attempts are denied. The new repository read must first authorize the run in the requested org and then load the keyed artifact from that same run. Never accept org/run identifiers from refs without checking them against the authorized root run.

30. **Cross-boundary validation.**
    Each decision ref must resolve to an artifact in the same org/run; its artifact key, semantic version, `data_as_of`, scope, snapshot refs, and source refs must match or be an allowed subset of the canonical Data pack. Metric/evidence paths must exist. Drill-down filters must be allowlisted by the use case and represent a same-scope subset. Any cross-run, cross-scope, cross-version, or cross-tenant ref is blocking.

## 6. Capability/status matrix

| Target area | Current status | Repository evidence | Required change |
|---|---|---|---|
| DecisionBrief | Partially exists | `DecisionBriefSchema`; `buildDecisionBrief`; optional report field | Version to v2 and make it a component of a persisted decision pack; preserve v1 |
| VisualStory | Partially exists | deterministic `ChartSpec`/`ChartPack` with purpose/provenance | Add typed narrative/order/highlights/annotations/reference lines/drill-down refs |
| PriorityEntities | Missing | only one max-concentration `where_to_look` signal | Add policy-driven, deterministic ranked entity contract/builder |
| ActionCandidates | Partially exists | two hard-coded `SupportedNextAction` kinds | Add use-case allowlist, support level, policy refs, typed targets, limitations |
| DrillDown | Partially exists | evidence drawer; `signal_ref`; inspect/analyze-zone action | Add first-class typed drill-downs and invariant-preserving resolver |
| Artifact handoff completeness | Missing | refs/limitations exist but no completeness state | Add versioned handoff schema to new pack and v2 workflow packs |
| Use-case materiality policy | Partially exists | hard-coded `notableChangeRules` | Move/configure under slow-moving use-case policy |
| Use-case priority policy | Missing | hard-coded insight-candidate ranking only | Add ordered eligibility/ranking/tie-break policy |
| Use-case action policy | Missing | hard-coded current brief actions | Add allowlisted action rules and support gates |
| Visualization policy | Missing | ChartBuilder emits deterministic charts but no primary story | Add preferred intents, max-primary, required context, ordering |
| Reviewer decision readiness | Missing | generic evidence/overstatement/limitation categories | Add decision-specific semantic categories and checks |
| Backward compatibility | Already exists in part | optional brief and historical tests | Add version unions/adapters; never require new pack for old runs |
| New autonomous decision agent | Should not be added | existing Insight→Report boundary is sufficient | Build a deterministic domain artifact in Insight checkpoint |
| New queue/runtime | Should not be added | current DAG, leases, scheduler, workers suffice | Reuse existing task/artifact model |
| Demand/funnel/activity conclusions | Should not be added yet | source schema lacks fields | Keep optional/unavailable and state missing inputs |
| Free-form priority/action generation | Should not be added | would bypass deterministic policy | LLM may only select/phrase from bounded IDs if enabled later |

## 7. Target architecture

### 7.1 First-class artifact choice

Use a **new persisted artifact** named `decision_intelligence_pack`, while **evolving the existing DecisionBrief contract** inside it.

Do not make the complete pack merely a field on `ReportPayload`:

- Report is produced too late and would keep chat/dashboard coupled to report generation.
- The full pack would duplicate chart, priority, action, and drill-down semantics in every report payload.
- A separately keyed artifact can be validated, fetched slim-first, linked from multiple product surfaces, and versioned independently.

Do not replace `DecisionBrief`:

- v1 already has useful signal/evidence semantics and current UI/API consumers.
- A discriminated version union provides safe history support.
- The v2 brief can preserve familiar signal concepts while referencing richer pack components.

Do not add a new task or agent:

- All required source packs exist by the end of the current Insight task.
- Construction and ranking are deterministic.
- The existing task graph already provides the correct dependency and retry boundary.

### 7.2 Target flow

```text
Coordinator
  → Data Agent / @vda/semantic canonical calculations
      → DataAnalysisPack v2
          ├─ ComparisonPack v2
          ├─ ChartPack v2
          └─ AnalysisPack v1/v2
              → InsightPack v2
                  → buildDecisionIntelligencePack(...)
                      policy + canonical packs only
                  → persisted decision_intelligence_pack
                      ├─ ReportDraft v2 consumes artifact
                      ├─ Reviewer checks decision readiness
                      ├─ publication validates exact graph
                      ├─ report embeds compatibility brief + artifact ID
                      ├─ Decision Intelligence API
                      ├─ decision-first report UI
                      └─ Agent Chat context/follow-ups
```

### 7.3 Package ownership

Recommended ownership:

- `@vda/contracts`: all schemas, versions, enums, and response types.
- `@vda/semantic`: generic deterministic calculations for materiality, contribution, comparability, and canonical metric extraction; functions accept policy inputs.
- `@vda/domain`: canonical use-case registry/policies, deterministic decision-pack assembly, invariant validation, and compatibility projection. This package is shared by Agents and DB and already depends on Contracts and Semantic.
- `@vda/agents`: orchestration only—load packs/policy, call domain builder, persist pack, pass it to Report/Reviewer/chat tools.
- `@vda/db`: authorized reads and publication-time graph validation.
- frontend: render typed components and execute typed navigation intent through existing APIs/state.

Move the canonical use-case registry from `src/backend/packages/agents/src/use-cases.ts` to `src/backend/packages/domain/src/use-cases.ts`. Leave `agents/src/use-cases.ts` as a temporary compatibility re-export. This avoids duplicating policies and lets both `SqlRepository` publication validation and agents resolve the same versioned policy without introducing a dependency from DB/Domain back to Agents.

The registry must retain both `slow-moving-inventory-v1` and `slow-moving-inventory-v2` and expose a version-aware lookup such as `getUseCaseDefinition(key, version)`. The persisted `CoordinatorDecision.use_case_version` is the retry/recovery pin: Data and every downstream stage must resolve policy from that persisted version, not from “current default.” This prevents a partially completed v1 run from resuming under v2 policy and conflicting with immutable keyed artifacts.

## 8. Proposed contract model

The following shapes are illustrative Zod-aligned TypeScript. Terra should follow the existing `.strict()`, bounded-array, bounded-string, literal-version, and `superRefine` conventions in `@vda/contracts`.

### 8.1 Shared references and handoff

```ts
const CanonicalMetricRefSchema = z.object({
  artifact_id: IdSchema,
  artifact_key: z.string().min(1).max(160),
  path: z.string().min(1).max(500),
  metric_key: MetricKeySchema,
}).strict();

const ArtifactHandoffSchema = z.object({
  completeness: z.enum(['complete', 'partial', 'insufficient']),
  available_components: z.array(z.string().min(1).max(100)).max(100),
  missing_components: z.array(z.object({
    component: z.string().min(1).max(100),
    reason: z.string().min(1).max(2_000),
    required_for_publication: z.boolean(),
  }).strict()).max(100),
  optional_inputs_present: z.array(z.string().min(1).max(100)).max(100),
  optional_inputs_missing: z.array(z.string().min(1).max(100)).max(100),
}).strict();
```

For v2 pack contracts, `handoff` is required. Historical v1 pack schemas remain parseable unchanged. Do not make the field optional on a schema whose literal version claims v2.

### 8.2 DecisionBrief v2

Keep `DecisionBriefV1Schema` exactly compatible with current persisted reports and keep the existing `DecisionBriefSchema`/`DecisionBrief` exports as v1 aliases during migration. Introduce `DecisionBriefV2Schema` separately; use a version union only at explicit version-aware read boundaries:

```ts
const AnyDecisionBriefSchema = z.discriminatedUnion('version', [
  DecisionBriefV1Schema,
  DecisionBriefV2Schema,
]);
```

V2 should contain:

```ts
{
  version: 'decision-brief-v2';
  headline: string;
  status: 'improving' | 'stable' | 'deteriorating' | 'mixed' | 'insufficient_evidence';
  scope: Scope;
  requested_data_as_of: DateString;
  effective_snapshot_date: DateString | null;
  semantic_version: string;
  kpi_cards: DecisionKpiCard[];
  material_changes: MaterialChange[];
  hotspots: Hotspot[];
  business_implications: BusinessImplication[];
  watchouts: DecisionWatchout[];
  data_quality_summary: DataQualitySummary;
  primary_visual_ids: string[];
  priority_entity_ids: string[];
  action_candidate_ids: string[];
  drilldown_ids: string[];
  evidence_refs: CanonicalEvidenceRef[];
  limitations: string[];
}
```

Rules:

- Headline is a deterministic template for the first implementation, derived from the highest-priority supported signal. It contains no unreferenced number.
- Status is a deterministic situation classification from the highest-priority comparable material-change rules. Artifact readiness belongs only in `handoff.completeness`; do not overload the business status with transport/completeness state.
- KPI values use `CanonicalMetricRef` and do not copy numbers unless the schema also validates exact equality to the ref.
- Every change includes window, comparison value, delta unit, comparability, materiality rule ID, and evidence refs.
- Business implications are bounded policy templates such as “inventory is concentrated in {entity}; inspect the contributing units.” They must be labeled descriptive or candidate implication and include support level.
- Arrays may be empty only with explicit handoff/limitation reasons.

### 8.3 VisualStory and ChartSpec v2

Add a versioned ChartSpec path rather than changing historical `chart-spec-v1` semantics in place. `ChartSpecV2` retains all v1 numeric provenance and adds:

```ts
{
  version: 'chart-spec-v2';
  // existing fields...
  purpose: 'current_state' | 'change' | 'concentration' |
           'comparison' | 'distribution' | 'data_quality';
  takeaway: string;
  story_role: 'primary' | 'supporting';
  display_priority: number;
  highlight_entities: EntityRef[];
  annotations: Array<{
    annotation_id: string;
    label: string;
    binding: ChartBinding;
  }>;
  reference_lines: Array<{
    reference_id: string;
    label: string;
    value: number;
    unit: MetricUnit;
    binding: ChartBinding;
  }>;
  comparison_context: {
    window_days: 7 | 30 | 90;
    current_snapshot_ref: Id;
    comparison_snapshot_ref: Id;
  } | null;
  drilldown_ids: string[];
}
```

Annotations and reference-line values must use the same binding validator as chart series. No free numeric annotation is allowed.

`VisualStory` should be compact and avoid copying chart data:

```ts
{
  version: 'visual-story-v1';
  headline: string;
  ordered_visuals: Array<{
    chart_id: string;
    role: 'primary' | 'supporting';
    display_priority: number;
    reason: string;
  }>;
  primary_visual_ids: string[]; // maximum 3
  supporting_visual_ids: string[];
  limitations: string[];
}
```

The `ChartPack` remains the canonical chart-data container. `VisualStory` controls selection and order by chart ID.

### 8.4 PriorityEntity

```ts
{
  priority_entity_id: string;
  entity: {
    type: 'unit' | 'zone' | 'unit_type' | 'bedrooms' | 'status' | 'project';
    key: string;
    label: string;
  };
  rank: number;
  tier: 'critical' | 'high' | 'medium' | 'watch';
  policy_rule_ids: string[];
  reason_codes: string[];
  metric_refs: CanonicalMetricRef[];
  evidence_refs: CanonicalEvidenceRef[];
  support_level: 'high' | 'medium' | 'limited';
  action_candidate_ids: string[];
  drilldown_ids: string[];
  limitations: string[];
}
```

First implementation:

- emit unit, zone, and unit-type priorities only when their required canonical inputs exist;
- allow bedrooms/status as generic segment entities but do not force them into the top list;
- do not emit project priority for a single-project run;
- do not emit price-band priority until a business band policy exists;
- use ordered rules and stable tie-breaks (`entity.type` then `entity.key`), not opaque LLM ranking;
- cap each entity type and total output through policy.

### 8.5 ActionCandidate

```ts
{
  action_candidate_id: string;
  kind:
    | 'inspect_entities'
    | 'compare_segments'
    | 'review_pricing'
    | 'review_demand'
    | 'review_sales_activity'
    | 'validate_candidate_driver'
    | 'open_report_section'
    | 'navigate_to_evidence';
  label: string;
  rationale: string;
  policy_rule_id: string;
  support_level: 'high' | 'medium' | 'exploratory';
  target_entity_ids: string[];
  target_signal_ids: string[];
  drilldown_id: string;
  evidence_refs: CanonicalEvidenceRef[];
  limitations: string[];
}
```

These are navigation/investigation candidates, never autonomous business decisions. Emit `review_demand` or `review_sales_activity` only when corresponding inputs exist; absence of those inputs belongs in `handoff.optional_inputs_missing`, not in an invented conclusion. `review_pricing` is allowed when a supported peer-price signal exists and must be described as a review, not a price-change recommendation.

### 8.6 DrillDown

Use a discriminated union with immutable context on every variant:

```ts
type DrillDownContext = {
  run_id: Id;
  org_id: Id;
  use_case: UseCaseKey;
  use_case_version: string;
  scope: Scope;
  requested_data_as_of: DateString;
  effective_snapshot_date: DateString | null;
  semantic_version: string;
  snapshot_refs: Id[];
};

type DrillDown =
  | { kind: 'open_report_section'; section_key: ReportSectionKey; context: DrillDownContext; ... }
  | { kind: 'open_chart'; chart_id: string; chart_pack_artifact_id: Id; context: DrillDownContext; ... }
  | { kind: 'open_evidence'; evidence_refs: CanonicalEvidenceRef[]; context: DrillDownContext; ... }
  | { kind: 'inspect_entities'; entity_refs: EntityRef[]; filters: TypedFilter[]; context: DrillDownContext; ... }
  | { kind: 'compare_segment'; dimension: SupportedDimension; segment_key: string; context: DrillDownContext; ... }
  | { kind: 'start_scoped_analysis'; target_scope: Scope; context: DrillDownContext; ... };
```

`TypedFilter` must use an operator enum and typed value, and its dimension must occur in the resolved use-case policy. In-run variants only alter view state over existing artifacts. `start_scoped_analysis` is explicitly a new run via the existing analysis endpoint, with the same requested `data_as_of` and a server-validated subset scope; it must not masquerade as same-run evidence.

### 8.7 DecisionIntelligencePack

```ts
{
  contract_version: 'decision-intelligence-pack-v1';
  pack_id: Id;
  run_id: Id;
  org_id: Id;
  use_case: UseCaseKey;
  use_case_version: string;
  scope: Scope;
  data_as_of: DateString;
  requested_data_as_of: DateString;
  effective_snapshot_date: DateString | null;
  semantic_version: string;
  input_refs: Id[];
  snapshot_refs: Id[];
  source_refs: Id[];
  data_analysis_pack_artifact_id: Id;
  comparison_pack_artifact_id: Id;
  chart_pack_artifact_id: Id;
  analysis_pack_artifact_id: Id;
  insight_pack_artifact_id: Id;
  decision_brief: DecisionBriefV2;
  visual_story: VisualStory;
  priority_entities: PriorityEntity[];
  action_candidates: ActionCandidate[];
  drilldowns: DrillDown[];
  handoff: ArtifactHandoff;
  evidence_refs: CanonicalEvidenceRef[];
  limitations: string[];
}
```

Cross-field refinements must enforce unique IDs, valid internal references, a maximum of three primary visuals, ranked entities with contiguous unique ranks, action kinds allowed by policy, and drill-down targets that exist in the same pack/input graph.

## 9. Use-case policy design

### 9.1 Generic policy contracts

Extend `UseCaseDefinitionSchema` to a v2 contract with:

- `materiality_policy`: ordered metric/delta rules, comparability requirement, watch/material thresholds, outcome direction (`higher_is_worse`, `higher_is_better`, or `context_only`), and rule IDs;
- `priority_policy`: supported entity types, eligibility predicates, ordered sort keys, tier rules, maximum results, and deterministic tie-breaks;
- `action_policy`: allowlisted action kind, triggering rule/signal type, minimum support, target type, label/rationale template ID;
- `visualization_policy`: preferred chart intents, primary count cap, required comparison context, and ordering;
- `audience_profile`: audience key (`sales_operations`), decision horizon, terminology, and visible-limitations requirement.

Policies should contain data and template IDs, not executable functions or LLM prompts. Generic evaluators in Semantic/Domain interpret them.

### 9.2 Slow-moving-inventory policy

Version the use case to `slow-moving-inventory-v2` and encode:

**Materiality**

- Preserve the current behavior represented by `notableChangeRules`:
  - inventory count relative delta: watch at 10%, material at 20%;
  - rate delta: watch at 5 percentage points, material at 10 percentage points;
  - price relative delta: watch at 10%, material at 20%.
- Require comparable current and prior snapshots.
- Preserve zero-baseline behavior and explicit abstention rather than division-by-zero substitution.
- Limit contribution-to-total-change to additive metrics such as available inventory and slow-moving-unit count. Never compute contribution for medians, quantiles, or rates.
- Mark available inventory, slow-moving-unit count/rate, and age as `higher_is_worse`; mark price change `context_only`. Derive `DecisionBriefV2.status` deterministically: detrimental and beneficial material signals together are `mixed`; detrimental only is `deteriorating`; beneficial only is `improving`; comparable inputs with no watch/material signal are `stable`; no comparable change is `insufficient_evidence`. A contextual price movement cannot determine status by itself.

**Priority**

- Eligible unit: within the canonical current scope/snapshot and currently available; slow-moving units rank before non-slow-moving units.
- Unit ordering: slow-moving classification, age bucket severity, age days descending, then stable unit key. A supported peer price/area gap may be a reason code, not a causal score.
- Eligible zone/unit type: supported breakdown with non-null denominator.
- Segment ordering: material contribution to additive change, then slow-moving count, then slow-moving rate, then available count, then stable segment key.
- Tier thresholds must reuse existing slow-moving threshold and approved age buckets. Do not invent new business thresholds. The current >180-day bucket may support `critical` only because it is already canonical.
- Cap results (for example five units and three segments) in configuration.

**Actions**

- `inspect_entities` for any ranked entity.
- `compare_segments` for supported zone/unit-type/bedroom/status concentration or change.
- `review_pricing` only when peer-price evidence is comparable; wording stays exploratory.
- `validate_candidate_driver` only for a qualified interpretive finding.
- `open_report_section` and `navigate_to_evidence` for all supported signals.
- Do not emit demand or sales-activity actions until those inputs are present.

**Visualization**

- Prefer one current-state/KPI view, one material-change/trend view, and one concentration view.
- Maximum three primary visuals.
- Demote price distribution or peer comparison to supporting unless a material price signal is selected.
- Charts without required comparison context may still be supporting but cannot make a change takeaway.

**Audience**

- `sales_operations`
- concise operational labels;
- explicit support and limitations;
- no causal or prescriptive language without corresponding support;
- priority is “where to inspect first,” not “what the business must do.”

### 9.3 Generic/runtime separation

Generic code may switch on contract enums such as `ActionKind` or `DrillDown.kind`. It must not contain checks such as `if (useCase === 'slow_moving_inventory')` in Report, Reviewer, API, chat, or UI. The resolved v2 policy controls behavior. Slow-moving-specific field names, thresholds, templates, and ordering live in the versioned use-case definition only.

## 10. Deterministic vs hybrid responsibilities

| Component | First implementation | Reason |
|---|---|---|
| KPI cards | Deterministic | Exact canonical metrics |
| Material changes | Deterministic | Existing period deltas + policy |
| Segment contribution | Deterministic | Additive snapshot comparison only |
| Hotspots/concentrations | Deterministic | Breakdown values + stable ordering |
| Priority entities | Deterministic | Policy eligibility/ranking/tie-break |
| Action eligibility | Deterministic | Policy allowlist/support gates |
| Drill-downs | Deterministic | Typed refs and approved filters |
| Visual selection/order | Deterministic | Visualization policy and chart availability |
| Headline | Deterministic template in the first implementation | Avoid new semantic risk |
| Business implications | Deterministic bounded templates | No unsupported causal inference |
| Chart takeaway | Deterministic template from bound metric/change | Must match chart exactly |
| Candidate driver wording | Hybrid, optional | Only from an `interpretive` finding, clearly qualified |
| Prose polish | Hybrid, optional | LLM may select/rephrase bounded IDs without adding facts |

No new LLM agent is needed. If provider-assisted wording is added after the deterministic release, it should use the existing bounded provider pattern from `insight-agent.ts` and be validated against selected signal/finding IDs.

## 11. Contract/schema/type changes

All paths below are real repository paths. Additive historical schemas must remain available wherever persisted old artifacts are parsed.

| File / symbol | Current role | Required change | Backward compatibility | Validation impact |
|---|---|---|---|---|
| `src/backend/packages/contracts/src/index.ts` / `DecisionBriefSchema` | Strict `decision-brief-v1` embedded in reports and returned by `/brief` | Alias the current schema/type as `DecisionBriefV1Schema`/`DecisionBriefV1`; retain `DecisionBriefSchema` and `DecisionBrief` as v1 compatibility exports; add separate `DecisionBriefV2Schema`/`DecisionBriefV2` and optional `AnyDecisionBriefSchema` union for version-aware internal readers | Existing report and `/brief` shapes remain byte-compatible | V2 validates component IDs/refs without widening the legacy route |
| same / `DecisionSignalSchema` | Numeric signal with evidence roles | Reuse for v1; add v2 KPI/change/hotspot schemas | No v1 field changes | Exact metric/delta binding |
| same / `SupportedNextActionSchema` | Two hard-coded action kinds | Keep for v1; add `ActionCandidateSchema` | Historical action behavior remains | Policy allowlist, support, targets, drill-down |
| same / `CanonicalEvidenceRefSchema` | Artifact ID/key/path | Add `CanonicalMetricRefSchema` and `EntityRefSchema` | Additive | Resolve same-run key/path/metric |
| same / `WorkflowPackMetadataSchema` | Common pack metadata | Keep v1; add v2 metadata with requested/effective dates and `handoff` | V1 packs remain valid | Scope/date/version parity |
| same / `UseCaseDefinitionSchema` | Registry definition v1 | Add v2 union and five policy schemas | Old coordinator versions are not reinterpreted | Validate IDs, dimensions, actions, caps, templates |
| same / `DataAnalysisPackSchema` | Canonical Data handoff | Add v2 segment-period contribution/comparability/handoff | Keep v1 in union | Exact calculation projection |
| same / `ComparisonPackSchema` | Comparison projection | Add v2 ranks, comparability, contribution, materiality refs | Keep v1 | Recompute/check order/contribution |
| same / `ChartSpecSchema` / `ChartPackSchema` | Numeric charts | Add v2 story metadata and handoff | Keep chart/pack v1 | Bind annotations, refs, takeaways |
| same / `AnalysisPackSchema` | Typed findings | Add v2 only if structured candidate-driver linkage is required | V1 remains accepted | Interpretive qualification |
| same / `InsightPackSchema` | Summary/claims | Add v2 handoff and structured selected IDs; no new numbers | Keep v1 | IDs must resolve |
| same / new `DecisionIntelligencePackSchema` | None | Add canonical aggregate contract | Absence allowed for old runs | Strong cross-field/graph validation |
| same / `ReportDraftSchema` | Five source-pack refs | Add v2 decision-pack ref | Keep v1 | Report must project pack |
| same / `ReportSectionSchema` | Fixed detailed-report section keys | Add decision-facing section keys only if Report sections directly link brief/story/priorities/actions; otherwise leave detailed keys unchanged and render the decision pack above them | Old keys remain accepted | Section refs must resolve in the same report graph |
| same / `ReportPayloadSchema` | Final structured report | Add optional `decision_intelligence_artifact_id`; keep optional v1 `decision_brief` as the compatibility projection | No-brief/v1 reports parse unchanged | For new reports, ID names the exact pack and embedded v1 brief equals the pack’s compatibility projection |
| same / `ReviewIssueSchema` | Generic review categories | Add decision support/materiality/priority/action/visual/drilldown/audience categories | Existing categories remain | Decision-specific review |
| same / `ArtifactSchema` | Closed Zod union | Add `decision_intelligence_pack` | DB kind is text | Typed storage/read |
| same / `DecisionBriefResponseSchema` | Slim v1 endpoint | Keep unchanged; add separate `DecisionIntelligenceResponseSchema` | Current route and clients keep the v1 shape | Both responses validate before return |
| same / `MessagePartSchema` | Chat refs | Add `decision_ref`/`drilldown_ref`; keep `signal_ref` | Existing messages parse | Reauthorize each action |
| same / `AgentTurnRequestSchema` | Signal action | Add typed drill-down ref/action; keep current fields | Existing clients work | Resolve server-side |
| `src/backend/packages/contracts/src/export.ts` | JSON Schema exporter | Export pack/response/v2 packs/policies | Existing schemas remain | Generated fixtures |
| `src/backend/packages/contracts/schema/*.json` | Generated contracts | Regenerate via `pnpm contracts:export` | Additive/versioned | Commit with source |

Do not bump `ARTIFACT_SCHEMA_VERSION` merely to add a union member. Component `contract_version` fields are the correct boundary unless the artifact envelope itself changes incompatibly.

## 12. Upstream deterministic enrichment

### 12.1 Comparison/materiality

Modify the generic calculations in `src/backend/packages/semantic/src/index.ts`:

1. Replace direct reads of module-level `notableChangeRules` with a passed `MaterialityPolicy` resolved from the use case.
2. Preserve half-up decimal behavior, zero-baseline abstention, snapshot matching, and evidence paths.
3. Add explicit comparability: `comparable`, `missing_current`, `missing_comparison`, `zero_baseline`, `incompatible_scope`, or `unsupported_metric`.
4. Add temporal segment comparison for additive metrics only:
   - match current and comparison rows by canonical unit/entity key;
   - aggregate the same dimension under both snapshots;
   - calculate segment absolute change;
   - calculate `contribution_to_total_change = segment_change / total_change` only when total change is non-zero and the metric is additive;
   - retain current/comparison snapshot refs and canonical evidence paths;
   - do not coerce missing segments to zero unless a complete snapshot proves absence.
5. Rank comparable segment changes deterministically and attach materiality policy rule IDs.
6. Add canonical segment `slow_moving_units` breakdowns (or an equivalently evidence-bound count projection from `CalculatedUnit[]`) before the priority policy uses slow-moving counts. The current `buildBreakdowns` output does not contain that metric, so the decision builder must not infer it from rates.

`src/backend/packages/agents/src/data-agent.ts` remains the only stage that invokes these calculations. `buildDataAnalysisPack` must project the enriched output exactly. `comparison-agent.ts` must remain non-calculating: it may sort/project canonical comparison records but must not derive new numbers.

### 12.2 Chart semantics

Modify `src/backend/packages/agents/src/chart-agent.ts` and the existing chart builder:

- generate `ChartSpecV2` from canonical values only;
- select purpose/takeaway templates from visualization policy;
- attach highlights only when entity refs exist;
- bind every annotation/reference line to a metric/evidence path;
- leave a chart `unavailable` when required context is absent;
- do not invent benchmark/reference-line values;
- extend existing numeric-integrity validation to new metadata.

### 12.3 Analyst and Insight

The first implementation does not need broader Analyst generation:

- `analyst-agent.ts` continues producing deterministic descriptive findings.
- Existing `kind` and `support_level` fields are sufficient.
- Candidate-driver support may later use qualified `interpretive` findings, never priority facts.

`insight-agent.ts` should add only structured selection IDs/handoff metadata needed by the builder. Its LLM boundary cannot introduce claims, numeric values, entity ranks, actions, or drill-downs.

## 13. Decision artifact builder

Add `src/backend/packages/domain/src/decision-intelligence.ts` with pure functions:

- `buildDecisionIntelligencePack(input, useCaseDefinition)`
- `validateDecisionIntelligencePack(pack, graph, useCaseDefinition)`
- `projectDecisionBriefV1Compatibility(pack)` only when a v1 response is needed
- helpers for KPI/change selection, priority ranking, action expansion, visual selection, and drill-down creation

Inputs are persisted Data, Comparison, Chart, Analysis, and Insight packs plus the exact use-case definition. The builder must not query the warehouse, call an LLM, or read mutable “latest” state.

Build order:

1. Validate metadata equality and lineage for all inputs.
2. Build handoff completeness.
3. Select policy-approved canonical KPI cards.
4. Select watch/material comparison changes.
5. Select supported hotspots.
6. Rank priority entities with policy/tie-breaks.
7. Select charts and assemble VisualStory.
8. Expand action rules over supported signals/entities.
9. Create drill-downs with immutable context.
10. Generate deterministic headline, implications, watchouts, and data-quality summary.
11. Deduplicate limitations/refs in stable order.
12. Parse and graph-validate the pack.

Stable ordering and IDs are required for retry idempotency. IDs derive from canonical keys/rule IDs, not random UUIDs.

## 14. Changes by logical stage

### Coordinator

**Input:** resolve the default `UseCaseDefinition v2` from Domain for a new run, or the already persisted Coordinator version during recovery.
**Output:** keep `CoordinatorDecision` and record `slow-moving-inventory-v2` for newly coordinated runs.
**Validate:** capability and exact policy version exist; downstream resolution uses `CoordinatorDecision.use_case_version`.
**Unchanged:** deterministic routing, scope/date/reuse/unsupported rules.

### Data Agent

**Input:** version-pinned definition from the persisted Coordinator decision, including materiality policy and priority-required metrics/dimensions.
**Output:** DataAnalysisPack v2 with comparability, additive contribution, policy IDs, and handoff.
**Validate:** generic policy evaluator and exact projection.
**Unchanged:** warehouse authority, deterministic calculation, no LLM.

### Comparison

**Input:** DataAnalysisPack v2.
**Output:** ComparisonPack v2 projects ranks/materiality/comparability/contribution.
**Validate:** projection equality and stable order.
**Unchanged:** no model, query, or independent arithmetic.

### Chart

**Input:** DataAnalysisPack v2 and visualization policy.
**Output:** ChartPack/ChartSpec v2 story/render metadata.
**Validate:** semantic integrity plus numeric binding.
**Unchanged:** every number remains deterministic/evidence-bound.

### Analyst

**Input:** optional policy vocabulary/support rules.
**Output:** no required v1 change; v2 only if candidate drivers ship.
**Validate:** interpretive findings require qualification/support/evidence/limitation.
**Unchanged:** no metric or priority calculation.

### Insight

**Input:** existing branch/Data packs plus policy.
**Output:** persist InsightPack then DecisionIntelligencePack before task success; return both.
**Validate:** Domain builder; recovery requires both keys for v2.
**Unchanged:** bounded provider/safe fallback.

### Report

**Input:** load the pack in `executeReportDraftStage`/`report-agent.ts`.
**Output:** ReportDraft v2 references it; ReportPayload links it and embeds only `projectDecisionBriefV1Compatibility(pack)` for existing consumers; the full v2 decision layer is rendered from the pack above the existing detailed sections.
**Validate:** exact pack link plus exact v1 compatibility projection; Report must not reconstruct priorities, actions, visual order, or drill-downs.
**Unchanged:** structured JSON, exact metrics/units, revision cap.

### Reviewer

**Input:** decision pack and graph.
**Output:** decision-specific ReviewIssue categories.
**Validate:** semantic review consumes deterministic prechecks and cannot redo arithmetic.
**Unchanged:** two revisions, evidence-bound corrections, deterministic final status.

### Technical Validator / Publication

**Input:** pack in expected keys/publication graph.
**Output:** checks cover schema, graph, policy, drill-down, report projection.
**Validate:** `validateDecisionIntelligencePack`.
**Unchanged:** atomic publication, PASS/hash binding, leases, in-transaction revalidation.

## 15. Technical validation specification

Implement deterministic blocking checks in `src/backend/packages/domain/src/decision-intelligence.ts`, `integrity.ts`, and `agent-workflow.ts`.

### Schema and graph

- Parse every contract/version.
- Pack, artifact envelope, run, org, task, and artifact key agree.
- All five input IDs exist and match their declared kinds/keys.
- Required predecessor refs are complete.
- Evidence/metric refs resolve to allowed input paths.
- Signal/entity/action/drill-down/chart IDs are unique and resolve.

### Scope, time, and tenancy

- All refs belong to one org/run.
- Use-case/version, scope, requested date, effective snapshot, semantic version, snapshot refs, and source refs agree with Coordinator/Data.
- Drill-down cannot broaden scope or change snapshot.
- `start_scoped_analysis` only narrows to a supported scope and retains requested date.
- API reauthorizes the root run and never trusts client-provided org context.

### Metrics, comparison, and charts

- KPI/change/hotspot values and units/currency equal canonical refs.
- Comparison windows and snapshot refs exist.
- Materiality exactly matches versioned policy.
- Contribution occurs only for additive metrics and recomputes under current Decimal/rounding rules.
- Ranks/tiers match eligibility/order/tie-break policy.
- Chart values, annotations, reference lines, highlights, and takeaways resolve to bindings.
- Primary visuals exist, are unique/ordered, and number at most three.

### Actions and drill-downs

- Action kind is policy-allowed and its trigger meets minimum support.
- Wording comes from a registered template, not free-form prescription.
- Every action points to an existing drill-down.
- Filter dimensions/operators are allowlisted; values exist in same-scope data.
- Report-section/chart/evidence targets exist.

### Handoff and report projection

- `complete` requires all policy-required components.
- `partial`/`insufficient` list concrete reasons.
- Missing optional demand/funnel/activity inputs block only if policy makes them required.
- ReportDraft references the exact pack.
- New report `decision_intelligence_artifact_id` names the exact pack and its embedded v1 brief exactly equals `projectDecisionBriefV1Compatibility(pack)`.
- Publication includes pack lineage/validation.

Cross-run, cross-scope, cross-tenant, or unresolved refs are blocking, never warnings.

## 16. Semantic review specification

Extend `src/backend/packages/agents/src/reviewer-agent.ts` and `review-workflow.ts` to ask:

- Does the headline reflect the highest-priority supported signal?
- Is “material” used only for policy-marked material changes?
- Are implications proportional to support?
- Are candidate drivers explicitly qualified/non-causal?
- Are actions investigations rather than autonomous decisions?
- Does each takeaway match its chart and comparison context?
- Are the primary visuals decision-relevant?
- Are missing windows, incomplete coverage, and optional-input gaps visible?
- Is the brief useful to Sales Operations?

The reviewer may request evidence-bound wording/visibility corrections. It must not alter a number, rank, tier, classification, binding, action eligibility, or filter; add unsupported content; claim causality; override deterministic failure; or independently return PASS.

Keep the provider boundary narrower than report generation. Add an internal `DecisionReviewRequestSchema` whose response contains only an allowlisted issue code, target component kind/ID, and correction kind such as `qualify_wording`, `surface_limitation`, `demote_visual`, or `remove_unsupported_implication`. Server code must resolve the target, render the final `ReviewIssue` from templates, reject unknown/duplicate/unresolvable requests, and retain the current rule that provider output cannot manufacture PASS. Deterministic validation runs before and after any correction. A configured provider failure follows the existing retry/fail-closed behavior; it is not converted to a semantic pass.

## 17. Persistence, API, cache, and authorization

### 17.1 Artifact storage

- Kind/key: `decision_intelligence_pack`
- Envelope: existing `ArtifactBase`
- Payload: `decision-intelligence-pack-v1`
- Task owner: existing `insight` task
- Visibility: workspace-visible like report/chart/insight, not draft/review-private
- Inputs: Data, Comparison, Chart, Analysis, and Insight pack IDs
- Snapshot/source refs: exact validated canonical union; never “latest”

Update `expectedArtifactKey` in `src/backend/packages/domain/src/agent-workflow.ts`, recovery/load helpers in `agents/src/workflow.ts` and `draft-workflow.ts`, and repository publication expectations.

### 17.2 Read API

Add to the repository interface and `SqlRepository`:

```ts
decisionIntelligence(
  userId: string,
  orgId: string,
  runId: string
): Promise<DecisionIntelligenceResponse>
```

Behavior:

1. Authorize membership and load the same-org run.
2. Return validated pack with `source: 'decision_intelligence_pack'` when present.
3. Otherwise adapt a published v1 brief with `source: 'legacy_report_brief'`, partial handoff, and unavailable new components.
4. If neither exists, return typed `DECISION_INTELLIGENCE_NOT_AVAILABLE` while leaving report reads usable.
5. Never recompute an old run under current versions.

Add `GET /runs/:id/decision-intelligence` in `src/frontend/src/server/api.ts` and return `DecisionIntelligenceResponseSchema`. Keep `GET /runs/:id/brief` and its v1 response schema unchanged. For a new run, that legacy route returns `projectDecisionBriefV1Compatibility(pack)`; for an old run it follows today’s embedded-report path.

### 17.3 Cache and authorization

- Use existing `Cache-Control: private, no-store`.
- In-memory client reuse is keyed by org/run/artifact and cleared on context change.
- All reads go through `SqlRepository.auth`.
- Query by `org_id + run_id + artifact_key`.
- Resolve drill-down server-side from authorized pack identity.
- Reauthorize when starting a scoped child run.
- Never expose ReportDraft/ReviewResult via a decision ref.

No DB migration is required: kind is text, payload is JSONB, artifact keys are already unique per run, and existing lineage/RLS/immutability applies.

## 18. Report UI and drill-down

### 18.1 Incremental UI

Extend `src/frontend/src/components/analysis-result.tsx`:

- keep `DecisionBriefView` for v1;
- add `DecisionIntelligenceView` for v2;
- compose KPI, changes, hotspot, VisualStory, PriorityEntities, ActionCandidates, and Watchouts;
- keep detailed report/evidence below;
- reuse `EvidenceDrawer` and current loading/unavailable patterns.

Render:

```text
Decision Brief
  → KPI cards
  → Material changes
  → Main hotspot / concentration
  → 2–3 primary visuals
  → Priority entities
  → Action candidates
  → Drill-down
  → Detailed report
  → Evidence / methodology
```

Extend `chart-renderer.tsx` to render takeaway, bound annotations/reference lines, highlights, role, limitations, and drill-down affordance while retaining accessible tables/fallbacks.

Update `workspace.tsx` to fetch the decision endpoint first, manage selected section/chart/entity/filter state, execute in-run drill-downs locally, use existing POST analysis for explicit `start_scoped_analysis`, and fetch full artifacts only for details/evidence.

No new frontend route is required initially. The existing stateful workspace fits typed artifact intent plus view state. A future shareable URL should serialize only a validated drill-down ID, never raw filter/scope JSON.

### 18.2 Partial rendering

- `handoff.completeness = complete`: complete hierarchy.
- `handoff.completeness = partial`: available sections plus prominent reasons.
- `handoff.completeness = insufficient`: detailed report/historical view remains accessible and no missing component is fabricated.
- A missing chart/comparison/action does not hide the whole brief.
- Missing demand/funnel/activity is “not available,” not empty performance.

## 19. Agent Chat integration

Modify `src/backend/packages/agents/src/chat.ts` and `tools.ts`:

- use authorized decision pack as compact active-run context;
- expose IDs, labels, support, limitations—not a second calculated summary;
- add a typed decision-item/drill-down resolver;
- preserve run/use-case/scope/date checks;
- attach `decision_ref`/`drilldown_ref` message parts;
- @Analyst loads referenced AnalysisPack/finding;
- @Comparison loads referenced comparison/materiality;
- @Chart loads referenced ChartSpec;
- @Report loads referenced report/section;
- no follow-up silently changes snapshot.

Modify `agent-chat.tsx` and `message-thread.tsx`:

- fetch `DecisionIntelligenceResponse` first and fall back to the unchanged v1 brief route for historical runs;
- preserve slim-first loading;
- render refs/actions as controls;
- lazy-load full artifacts on inspect;
- preserve historical `signal_ref`.

Current `analyze_segment` creates a new zone-scoped run. Keep it as `start_scoped_analysis`, label it explicitly, and preserve requested date. In-run compare/inspect must not create a run.

## 20. Backward compatibility and failure behavior

### Historical run without a decision artifact

- Final report parses/renders.
- Decision endpoint adapts legacy brief or returns typed unavailable.
- Current detailed result remains accessible.

### Historical DecisionBrief v1

- Render existing `DecisionBriefView`.
- Mark new components unavailable instead of fabricating them.
- Existing `signal_ref` messages work.

### Partial new artifact

- It remains schema-valid.
- `handoff.completeness = 'partial'` and reasons are required.
- Policy-required absence blocks publication; optional absence does not.
- UI renders available portions.

### Missing comparison windows

- Comparison/contribution abstain.
- No change headline/materiality/trend takeaway is emitted.
- Current KPIs/hotspots may still produce a partial artifact with an `insufficient_evidence` situation status when no comparable change exists.

### Missing demand/funnel/activity

- No corresponding claim/action is emitted.
- Missing inputs are explicit.
- Inventory/pricing review remains evidence-gated.

### Old versions

- Parse historical contracts.
- Never rebuild with current semantic/use-case policy.
- Compatibility is a persisted-data projection only.

### Invalid new pack

- Insight fails before success, or publication fails closed.
- No final report publishes from an invalid/cross-run pack.
- Retry uses current attempts/leases.

## 21. Test plan

Use existing Vitest, PGlite/Postgres, React static-render, and Playwright conventions.

### Contracts

Update `src/backend/tests/unit/agent-workflow-contracts.test.ts`:

- parse new v2 schemas/artifact union;
- reject duplicate/dangling IDs, >3 primary visuals, malformed handoff;
- keep v1 brief and old pack fixtures parseable;
- keep ReportPayload without a brief parseable.

Regenerate schemas through `src/backend/packages/contracts/src/export.ts`.

### Policy and comparison

Update `src/backend/tests/unit/semantic.test.ts`:

- reproduce current thresholds through policy;
- test watch/material boundaries;
- preserve absolute delta and abstain relative math at zero baseline;
- test comparable/missing snapshots;
- test additive contribution sum/rounding;
- reject contribution for rates/medians;
- test stable ranking/ties and missing-window abstention.

Update `src/backend/packages/agents/src/data-agent.test.ts` and `coordinator.test.ts`:

- resolved policy reaches Semantic;
- Data pack exactly projects results;
- v2 use-case version is pinned;
- no new query/LLM path appears.

### Charts

Update `src/backend/tests/unit/chart-builder.test.ts`:

- policy purpose/takeaway/role/priority;
- existing highlight targets;
- bound annotations/reference lines;
- unavailable unsupported context;
- rejection of unbound numbers.

Update `src/frontend/src/components/chart-renderer.test.tsx` for takeaway, annotations, reference lines, highlights, limitations, and drill-down while retaining existing chart-type tests.

### Decision builder

Add `src/backend/packages/domain/src/decision-intelligence.test.ts`:

- complete slow-moving pack;
- stable IDs/order;
- KPI/headline/change/hotspot selection;
- priority eligibility/rank/tier;
- action allowlist/support;
- max-three visual story;
- immutable drill-down context;
- partial handoff;
- no unsupported demand/causal output;
- policy-version mismatch rejection.

### Workflow/reviewer/publication

Update:

- `src/backend/packages/agents/src/draft-workflow.test.ts`: both Insight outputs, Report consumption, exact projection, retry/recovery.
- `src/backend/packages/agents/src/reviewer-agent.test.ts`: unsupported headline/action, overstatement, unqualified driver, visual mismatch, no provider override.
- `src/backend/packages/agents/src/agent-workflow.test.ts`: artifact end-to-end, revision cap, leases, recovery, mutated-pack rejection.
- `src/backend/packages/agents/src/artifact-visibility.test.ts`: viewer reads pack; drafts/reviews remain private.
- `src/backend/tests/unit/pipeline.test.ts`: final linkage, v1/no-brief history, fabricated values/evidence/units/currency/cross-run rejection.

### Repository/API/security

Update `src/backend/packages/db/src/repository.test.ts` and `postgres-schema.test.ts`:

- keyed pack idempotency;
- no enum/migration dependency;
- authorized same-org read;
- cross-org/run denial;
- publication graph rejection;
- legacy fallback never recomputes.

Update `src/backend/tests/e2e/mvp.spec.ts`:

- decision endpoint for completed run;
- `private, no-store`;
- viewer access and cross-workspace denial;
- same-run ref resolution;
- historical fallback;
- end-to-end slow-moving request to published report/UI contract.

### Frontend and chat

Update `src/frontend/src/components/analysis-result.test.tsx`:

- decision-first order;
- complete/partial/insufficient handoff plus v1/no-brief states;
- priorities/actions/drill-down/limitations;
- detailed report remains reachable.

Update `src/frontend/src/components/agent-chat/agent-chat.test.tsx`, `src/backend/packages/agents/src/chat.test.ts`, and `tools.test.ts`:

- slim pack first and lazy full artifacts;
- in-run inspect/compare;
- Analyst/Comparison/Chart/Report handoff;
- explicit scoped analysis preserving date;
- unauthorized/cross-run/stale-version/invalid drill-down rejection;
- historical signal behavior.

## 22. Sequential implementation phases

Each phase is independently reviewable and leaves the repository in a compatible state. Do not start a later producer until every schema and validator it depends on has landed.

### Phase 1 - versioned contracts and use-case lookup

**Objective**

Create the type boundary without changing runtime output. Preserve every v1 reader and establish version-aware policy resolution for retries.

**Files and symbols**

- `src/backend/packages/contracts/src/index.ts`: retain `DecisionBriefSchema`/`DecisionBrief` as v1 compatibility exports; add the v2 decision, visual-story, priority, action, drill-down, handoff, pack, response, and versioned use-case schemas described in Section 11.
- `src/backend/packages/contracts/src/export.ts` and `src/backend/packages/contracts/schema/*`: export generated JSON schemas for every externally persisted or returned v2 contract.
- `src/backend/packages/domain/src/use-cases.ts` (new) and `src/backend/packages/domain/src/index.ts`: own `getUseCaseDefinition(useCase, version)` and the immutable v1/v2 registry.
- `src/backend/packages/agents/src/use-cases.ts`: become a compatibility re-export/caller so existing imports do not break.
- `src/backend/packages/agents/src/coordinator.ts` and its input/output types: continue persisting `CoordinatorDecision.use_case_version`; resolve by both use-case and version after coordination.

**Behavioral change**

No published payload changes yet. A new run may be coordinated against v2 only after the v2 definition exists. A resumed run always reloads the exact version already named in `CoordinatorDecision`, never the registry's current default.

**Tests**

Extend `agent-workflow-contracts.test.ts` and `coordinator.test.ts` with v1/v2 parse, duplicate policy-ID rejection, missing-version failure, v1 retry pinning, and old fixture coverage. Regenerate schemas and assert they are current.

**Acceptance criteria**

- Existing v1 reports and `/brief` types compile and parse unchanged.
- V2 policies and pack shapes are strict Zod contracts.
- Registry lookup is deterministic by `(use_case, use_case_version)`.
- No decision artifact is produced yet.

**Dependencies:** none.

### Phase 2 - deterministic slow-moving policy primitives

**Objective**

Move hard-coded materiality/priority/action semantics into the versioned slow-moving definition and add only the canonical data required to evaluate them.

**Files and symbols**

- `src/backend/packages/domain/src/use-cases.ts`: add `slow-moving-inventory-v2` materiality, status direction, priority, action, visualization, and audience data.
- `src/backend/packages/semantic/src/index.ts`: parameterize `buildPeriodComparisons`/`detectChanges`; add comparability, additive segment-period comparison/contribution, stable ranking inputs, and a current-snapshot `slow_moving_units` segment breakdown.
- `src/backend/packages/agents/src/data-agent.ts`: pass the resolved v2 definition into Semantic and project the enriched canonical result without recalculation.
- `src/backend/packages/agents/src/comparison-agent.ts`: project materiality, comparability, rank inputs, and contribution from the Data pack; do not query data or call a provider.
- `src/backend/packages/agents/src/agent-workflow.ts` and `draft-workflow.ts`: load the coordinator-pinned definition for downstream evaluation.

**Behavioral change**

V1 follows its current thresholds. V2 emits explicit comparability and materiality rule IDs. Contribution is available only for additive metrics and matched snapshots/scopes; medians/rates abstain. Priority inputs use stable canonical entity keys.

**Tests**

Update `semantic.test.ts`, `data-agent.test.ts`, `coordinator.test.ts`, and branch workflow tests for threshold boundaries, outcome direction/status inputs, zero baselines, missing or incompatible snapshots, additive contribution reconciliation, rate/median abstention, stable ties, and the new segment count.

**Acceptance criteria**

- Existing numeric and rounding behavior is unchanged for v1.
- Every new numeric value is calculated by Semantic and has an evidence path.
- No LLM/provider participates in materiality, contribution, ranking, or action eligibility.
- V2 partial retries resolve the persisted v2 definition.

**Dependencies:** Phase 1.

### Phase 3 - versioned visual and branch handoffs

**Objective**

Make chart/story inputs and artifact completeness explicit while preserving the parallel Comparison/Chart/Analyst branches.

**Files and symbols**

- `src/backend/packages/agents/src/chart-builder.ts` and `chart-agent.ts`: produce ChartSpec v2 purpose, takeaway, story role, display priority, bound highlights/annotations/reference lines, comparison context, limitations, and typed drill-down targets from policy plus canonical inputs.
- `src/backend/packages/agents/src/analyst-agent.ts`: retain descriptive findings; only emit an interpretive/candidate-driver finding when its support and qualification fields validate.
- `src/backend/packages/agents/src/insight-agent.ts`: retain the current bounded synthesis and add v2 handoff completeness/reason information for the decision builder.
- `src/backend/packages/contracts/src/index.ts`: use versioned Chart/Analysis/Insight pack schemas without widening v1 contracts.

**Behavioral change**

Charts remain deterministic. Story metadata selects and explains existing bound values; it cannot introduce a value. Missing comparison context demotes a visual or removes its change takeaway rather than fabricating context.

**Tests**

Update `chart-builder.test.ts`, `branch-workflow.test.ts`, pack contract tests, and `chart-renderer.test.tsx` fixtures for binding integrity, primary/supporting roles, policy ordering, unsupported reference rejection, qualified drivers, and partial handoffs.

**Acceptance criteria**

- Every numeric annotation/reference line resolves through `ChartProvenanceBindingSchema`.
- Primary visual count and order follow policy.
- Branches still execute once, in parallel, with no loop or new queue.
- V1 chart fixtures still parse and render.

**Dependencies:** Phases 1-2.

### Phase 4 - deterministic decision-intelligence builder

**Objective**

Assemble the five product-contract components in one domain function from already validated artifacts and the pinned policy.

**Files and symbols**

- `src/backend/packages/domain/src/decision-intelligence.ts` (new): implement `buildDecisionIntelligencePack`, `validateDecisionIntelligencePack`, deterministic template rendering, ref resolution, status derivation, ranking/action gating, and `projectDecisionBriefV1Compatibility`.
- `src/backend/packages/domain/src/integrity.ts`: expose/reuse canonical metric/evidence/scope/date validation helpers rather than duplicating them.
- `src/backend/packages/domain/src/index.ts`: export the builder/validator.
- `src/backend/packages/domain/src/decision-intelligence.test.ts` (new): cover the builder as specified in Section 21.

**Behavioral change**

Given the same five input packs and use-case version, the builder returns byte-stable component IDs/order/content. It emits complete, partial, or insufficient handoff state; it never calls a model, warehouse, repository, or clock.

**Tests**

Add golden and negative unit fixtures covering all components, stable IDs/order, status direction, action gates, unsupported optional inputs, cross-input refs, maximum visuals/entities, and exact v1 compatibility projection.

**Acceptance criteria**

- The builder is pure and deterministic.
- All output claims, numbers, entities, and actions trace to inputs plus a policy/template ID.
- A cross-run/scope/version/date reference is rejected.
- Rebuilding from identical inputs yields an identical hash.

**Dependencies:** Phases 1-3.

### Phase 5 - workflow persistence, report, review, and publication

**Objective**

Make the pack first-class at the existing Insight boundary, then require downstream Report/Reviewer/publication to consume it.

**Files and symbols**

- `src/backend/packages/agents/src/draft-workflow.ts`: after the existing `insight_pack`, build/store keyed `decision_intelligence_pack` under the same Insight task and require both keys for v2 recovery.
- `src/backend/packages/agents/src/workflow.ts` and `src/backend/packages/domain/src/agent-workflow.ts`: add the expected key/kind and graph validator without adding a task kind or DAG node.
- `src/backend/packages/agents/src/report-agent.ts` and `report-sections.ts`: read the pack; link it in ReportDraft/ReportPayload; render its decision layer and exact v1 projection; stop independently choosing priorities/actions/story order.
- `src/backend/packages/agents/src/reviewer-agent.ts` and `review-workflow.ts`: add bounded `DecisionReviewRequestSchema` issue output and the semantic checks in Section 16.
- `src/backend/packages/agents/src/publication.ts`: load the exact decision pack and include it in the existing fenced, in-transaction validation immediately before final publication.
- `src/backend/packages/domain/src/integrity.ts` and `agent-workflow.ts`: add pre/post-review and in-transaction publication validation.

**Behavioral change**

Insight task success for v2 means both InsightPack and DecisionIntelligencePack exist. Report consumes the exact pack. Reviewer can request bounded wording/visibility changes but not mutate numeric/policy decisions. Publication fails closed on missing/invalid packs or projections. The existing two-review-attempt cap, leases, fencing, and atomic publication remain.

**Tests**

Update `draft-workflow.test.ts`, `reviewer-agent.test.ts`, `agent-workflow.test.ts`, `artifact-visibility.test.ts`, and `pipeline.test.ts` for dual-output recovery, idempotent retry, exact projection, semantic issue binding, provider failure, hash/PASS binding, revision cap, and publication-time mutation rejection.

**Acceptance criteria**

- A v2 final report cannot publish without the validated pack.
- V1 runs use their old recovery/publication graph.
- No new agent, task, queue, worker, scheduler, or unbounded loop exists.
- Report and Reviewer do not recalculate metrics or rankings.

**Dependencies:** Phase 4.

### Phase 6 - repository and authorized read API

**Objective**

Expose the persisted pack through existing repository/auth patterns while preserving the legacy brief endpoint.

**Files and symbols**

- `src/backend/packages/db/src/types.ts`: add `decisionIntelligence(userId, orgId, runId)` to `Repository`.
- `src/backend/packages/db/src/repository.ts`: load the succeeded run and keyed pack, revalidate the publication graph, enforce membership/org/run constraints, and provide the non-persisted legacy adapter.
- `src/frontend/src/server/api.ts`: add `GET /api/v1/runs/:id/decision-intelligence` next to the current brief handler and parse the response contract.
- `src/frontend/src/app/api/v1/[...path]/route.ts`: continue using the existing catch-all; no route-specific auth bypass.

**Behavioral change**

New runs return the persisted v2 pack response. Old runs return an explicit `legacy_report_brief` adapter or typed unavailable state without recomputation. `/api/v1/runs/:id/brief` remains byte-compatible and returns the exact v1 projection for new runs. Both endpoints retain `Cache-Control: private, no-store`.

**Tests**

Update repository, Postgres schema, pipeline, and e2e tests for owner/viewer access, nonmember/cross-org/cross-run rejection, malformed lineage, cache headers, legacy/no-brief behavior, and absence of enum/schema migration assumptions.

**Acceptance criteria**

- Server-side authorization is executed for every fetch.
- Client org IDs or artifact IDs cannot redirect the lookup.
- Historical reports remain readable.
- No database migration is added; existing text kind/JSONB/key/lineage storage is sufficient.

**Dependencies:** Phase 5.

### Phase 7 - decision-first report UI and typed drill-down

**Objective**

Incrementally place the decision layer above the existing detailed report and make same-run exploration explicit.

**Files and symbols**

- `src/frontend/src/components/workspace.tsx`: fetch the new slim response first, keep detailed artifact loading lazy, and own selected component/drill-down view state.
- `src/frontend/src/components/analysis-result.tsx`: add `DecisionIntelligenceView` and preserve `DecisionBriefView` for v1.
- `src/frontend/src/components/chart-renderer.tsx`: render story metadata and typed interactions while keeping accessible data-table fallback.
- Existing component styles only where required; do not redesign unrelated screens.

**Behavioral change**

The visible order follows the requested decision-first hierarchy. In-run drill-down resolves an artifact ID declared in the pack and only filters/navigates within the same run/scope/snapshot. `start_scoped_analysis` is visibly a new child analysis and preserves the requested date. Raw URLs or raw client filter JSON never become canonical actions.

**Tests**

Update `analysis-result.test.tsx`, `chart-renderer.test.tsx`, workspace/component tests, and `mvp.spec.ts` for hierarchy, complete/partial/insufficient rendering, fallback, accessible charts, valid/invalid filters, same-run context, and explicit new-run behavior.

**Acceptance criteria**

- Decision content appears before detailed sections for v2.
- Old/no-brief reports still render.
- Drill-down cannot broaden scope or change date/version/snapshot.
- Two to three primary visuals render when supported; missing visuals do not collapse the report.

**Dependencies:** Phase 6.

### Phase 8 - Agent Chat reuse

**Objective**

Use the same compact decision artifact for chat grounding and specialist handoffs instead of creating a second analytical summary.

**Files and symbols**

- `src/backend/packages/agents/src/chat.ts` and `provider.ts`: construct active context from authorized decision component IDs/labels/support/limitations, not raw new calculations.
- `src/backend/packages/agents/src/tools.ts`: resolve decision/drill-down refs and load the referenced Analysis/Comparison/Chart/Report artifact only on inspect/follow-up.
- `src/backend/packages/contracts/src/index.ts`: add backward-compatible decision/drill-down message parts and bounded actions.
- `src/frontend/src/components/agent-chat/agent-chat.tsx` and `message-thread.tsx`: fetch/render new refs, lazy details, and legacy `signal_ref` fallback.

**Behavioral change**

The slim decision pack is loaded first. `@Analyst`, `@Comparison`, `@Chart`, and `@Report` follow a validated pack reference. Same-run inspect/compare preserves context; scope/date changes require the existing explicit analysis creation path.

**Tests**

Update `chat.test.ts`, `tools.test.ts`, `agent-chat.test.tsx`, and e2e chat coverage for all specialist handoffs, lazy loading, unsupported ref rejection, cross-run/tenant isolation, history, and requested-date preservation.

**Acceptance criteria**

- Chat and report display the same IDs, values, priority order, actions, and limitations.
- The chat provider receives no authority to calculate or invent values.
- Historical `signal_ref` messages remain functional.
- Full artifacts are fetched only for a selected follow-up.

**Dependencies:** Phases 6-7.

### Phase 9 - compatibility, security, and end-to-end hardening

**Objective**

Close version, retry, isolation, optional-data, and historical gaps before declaring the feature complete.

**Files and symbols**

- The contract, domain, repository, workflow, frontend, chat, and e2e test files listed in Section 21.
- `src/backend/tests/e2e/mvp.spec.ts`: add the complete Sales Operations slow-moving scenario.
- `src/backend/packages/contracts/schema/*`: final generated-schema consistency check.
- Documentation only where public endpoint/contracts require it; no unrelated architecture rewrite.

**Behavioral change**

None beyond failures becoming explicit and fail-closed. Validate no-comparison, missing demand/funnel/activity, partial packs, old semantic/use-case versions, retries after each stage, and malicious reference substitution.

**Tests**

Run the focused suites first, then the repository's normal full test/typecheck/build checks. Include real Postgres/RLS coverage where existing CI provides it, not only the in-memory repository.

**Acceptance criteria**

- Complete slow-moving request publishes and renders/chat-loads one canonical decision artifact.
- Every required negative/security/backward-compatibility test passes.
- Generated schemas and source schemas agree.
- No unrelated refactor or production migration is present.

**Dependencies:** Phases 1-8.

## 23. Recommended commit boundaries

These are implementation commits Terra should create; this review task does not create them. Keep generated schemas and tests with the behavior they verify.

1. `feat: add versioned decision intelligence contracts`
   - V2 component/pack/API schemas, generated schemas, versioned registry lookup, and compatibility tests.
2. `feat: add slow-moving decision policies`
   - Policy data/evaluators, canonical segment-period inputs, materiality/status direction, contribution, deterministic ranking inputs, and tests.
3. `feat: enrich visual story and branch handoffs`
   - Bound ChartSpec v2 metadata, Analysis/Insight handoff refinements, and chart/branch tests.
4. `feat: build deterministic decision intelligence pack`
   - Pure Domain builder/validator, compatibility projection, and complete unit tests.
5. `feat: persist and review decision intelligence`
   - Insight dual-output persistence/recovery, Report consumption, bounded semantic review, publication validation, and workflow tests.
6. `feat: expose authorized decision intelligence API`
   - Repository read/legacy adapter, server endpoint, cache/auth/security tests; no DB migration.
7. `feat: render decision-first reports and drill-downs`
   - Incremental report/chart UI, same-run navigation, historical fallback, and component/e2e tests.
8. `feat: reuse decision intelligence in agent chat`
   - Compact context, specialist handoffs, typed refs/actions, lazy loading, and chat tests.
9. `test: harden decision intelligence compatibility and isolation`
   - Cross-version, RLS, retry, optional-input, malicious-ref, and full slow-moving end-to-end coverage not naturally contained in the earlier commits.

Do not split commits by backend/frontend file type, and do not combine an unrelated cleanup with any boundary above.

## 24. Unresolved product questions

Repository inspection resolves the technical placement and data flow. Only these external product-policy decisions remain:

### 24.1 Approval of v2 policy constants and wording

**Why it matters:** The repository contains current materiality thresholds, canonical age buckets, and two action patterns, but it does not establish business ownership for new result caps, tier labels, audience wording, or which context-only price signals Sales Operations wants promoted.

**Default implementation assumption:** Preserve current materiality thresholds and age buckets exactly; use conservative configured caps (five units, three segments, three primary visuals); treat price as context-only; use investigative, non-prescriptive templates; retain the provisional-policy limitation.

**If wrong:** Change only `slow-moving-inventory-v2` policy/template data and its fixtures. The generic builder, report, API, UI, and chat architecture should not change.

### 24.2 Consumers outside this repository of `/runs/:id/brief`

**Why it matters:** Repository callers can be migrated safely, but source inspection cannot prove that no external client relies on the exact v1 response.

**Default implementation assumption:** Keep the endpoint and `DecisionBriefResponseSchema` byte-compatible indefinitely and add the separate decision-intelligence endpoint.

**If wrong:** If all external consumers are confirmed migrated, deprecation can be scheduled later. It is not a prerequisite and should not widen this implementation.

## 25. Definition of Done

The change is complete only when all of the following are true:

- A strict, versioned, persisted `decision_intelligence_pack` contains DecisionBrief, VisualStory, PriorityEntities, ActionCandidates, and DrillDown with same-run lineage.
- The artifact is assembled deterministically at the existing Insight boundary; no new LLM agent, task, queue, runtime, or unbounded loop was introduced.
- Report and Agent Chat consume the same artifact and do not independently recreate priorities, actions, visual order, or metric summaries.
- Data Agent/Semantic remain the canonical numeric authority; no unsupported numeric generation is possible in Chart, Analyst, Insight, Report, Reviewer, UI, or chat.
- Materiality, decision status, priority, action eligibility, visualization selection, and audience wording follow the pinned versioned policy.
- Every numeric value, chart mark, annotation, material change, priority reason, and supported action resolves to canonical metric/evidence refs.
- Typed drill-down preserves `run_id`, org/workspace authorization, requested/effective dates, semantic/use-case versions, scope, filters, snapshots, and lineage; a new scope/date creates an explicitly labeled new analysis.
- Deterministic validation rejects schema, metric/evidence, scope/date/version, chart, policy, action, drill-down, cross-run, and cross-tenant violations.
- Reviewer performs bounded decision-readiness checks for support, qualification, visual fit, visible limitations, and Sales Operations usefulness without overriding deterministic validation.
- Existing v1 reports, no-brief reports, old semantic/use-case versions, and historical chat `signal_ref` messages continue to work without being rebuilt under current policy.
- Missing comparisons and optional demand/funnel/activity produce typed abstention/partial states, never fabricated claims or actions.
- The existing artifact JSONB/text-kind storage is used; no database migration is required or added.
- The slow-moving inventory flow passes contract, policy, builder, workflow, publication, API authorization, frontend, chat/navigation, Postgres/RLS, and end-to-end tests.
- Generated schemas are current, normal repository validation passes, and the implementation contains no unrelated refactor.

## 26. Plan verification checklist

- [x] Based on the inspected runtime, contracts, repository, UI, chat, tests, and persistence code rather than filenames alone.
- [x] References real repository files and symbols.
- [x] Preserves Data/Semantic as deterministic quantitative foundations.
- [x] Does not make an LLM a metric, materiality, priority, or action calculator.
- [x] Evolves the existing DecisionBrief, registry, artifact, lineage, report, and chat abstractions without a parallel platform.
- [x] Keeps generic runtime behavior separate from slow-moving policy data.
- [x] Defines historical, partial, optional-input, and version compatibility.
- [x] Specifies tests, acceptance criteria, dependencies, and safe behavior-based commit boundaries.
- [x] Is sequential and concrete enough for Terra to implement without redesigning the architecture.

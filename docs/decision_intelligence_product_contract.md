# VDaAgent — Decision Intelligence Product Contract

## 1. Purpose

VDaAgent should treat the following as a **first-class product contract**, not as incidental report formatting or UI-only presentation logic:

> **DecisionBrief + VisualStory + PriorityEntities + ActionCandidates + DrillDown**

This contract is the bridge between evidence-backed analytics and operational decision-making.

The existing multi-agent architecture is already designed around a strong quantitative foundation:

- the Data Agent owns canonical metrics;
- deterministic code owns warehouse queries, filtering, aggregation, classifications, historical comparisons, quality checks, and evidence lineage;
- downstream agents interpret, compare, visualize, synthesize, review, and communicate;
- Report Agent does not independently recompute metrics;
- Reviewer Agent validates wording, evidence support, contradictions, overstatement, and suitability for the business audience;
- technical validation remains deterministic and separate from semantic review.

The missing layer is not another general-purpose LLM agent. The missing layer is a stable, typed, reusable **decision-intelligence artifact** that makes analytical output immediately understandable and actionable for a business operator such as Sales Operations.

---

## 2. Problem Statement

A technically correct analytical report can still be operationally weak.

A Sales Operations user usually needs to understand the following questions quickly:

1. **What is happening?**
2. **How much did it change?**
3. **Where is the problem concentrated?**
4. **Why does it matter?**
5. **Which entities should receive attention first?**
6. **What should I inspect or do next?**
7. **How can I drill into the evidence without losing scope, date, or lineage?**

The current reporting architecture contains most of the required evidence, but the product contract should explicitly encode these answers instead of expecting Report Agent prose or frontend rendering logic to infer them ad hoc.

Therefore, VDaAgent should promote decision-oriented output to a canonical artifact boundary.

---

## 3. Product Principle

The core product principle is:

> **VDaAgent should not stop at producing a correct analysis. It should produce a decision-ready representation of that analysis while preserving deterministic truth and evidence lineage.**

This does **not** mean allowing an LLM to choose arbitrary actions or invent business recommendations.

Instead:

- quantitative truth remains canonical and deterministic;
- prioritization should be policy-driven where possible;
- action candidates should be evidence-backed and bounded by configured use-case policies;
- visual emphasis should be traceable to material changes or concentrations;
- drill-downs should navigate to validated scopes/entities already represented in canonical artifacts;
- all decision-facing statements must preserve evidence references and limitations.

---

## 4. First-Class Contract

The decision-intelligence contract consists of five major components:

```text
Decision Intelligence Contract
│
├── DecisionBrief
├── VisualStory
├── PriorityEntities
├── ActionCandidates
└── DrillDown
```

These components should be typed, persisted, versioned, validated, and reusable across product surfaces.

They must not exist only as generated Markdown or transient frontend state.

---

# 5. DecisionBrief

## 5.1 Responsibility

`DecisionBrief` is the compact operational summary of a completed analytical run.

It should answer, in order:

```text
What is happening?
What changed?
Where is it concentrated?
Why does it matter?
What needs attention?
What should the user inspect next?
What limitations affect confidence?
```

It is not a replacement for the detailed report.

It is the first layer of the report and the reusable summary artifact for dashboard, chat, notifications, executive summaries, and mobile surfaces.

## 5.2 Conceptual contract

```ts
type DecisionBrief = {
  id: string;
  run_id: string;
  org_id: string;
  use_case: string;
  scope: ScopeRef;
  data_as_of: string;
  semantic_version: string;

  headline: string;
  status: DecisionStatus;

  kpi_cards: KpiCard[];
  material_changes: MaterialChange[];
  hotspots: Hotspot[];
  business_implications: BusinessImplication[];

  priority_entities: PriorityEntityRef[];
  action_candidates: ActionCandidateRef[];
  drilldowns: DrillDownRef[];

  watchouts: Watchout[];
  data_quality_summary: DataQualitySummary;

  evidence_refs: EvidenceRef[];
  limitations: Limitation[];
  created_at: string;
};
```

## 5.3 Important rules

- `DecisionBrief` must not introduce unsupported metrics.
- Every numeric value must reference canonical metric or comparison artifacts.
- `status` must come from deterministic or explicitly configured decision/materiality policy where possible.
- A textual headline may be LLM-generated, but its factual content must be traceable.
- Missing comparison windows must be represented explicitly rather than silently omitted.
- Data-quality issues that materially affect interpretation must be surfaced in the brief.

---

# 6. VisualStory

## 6.1 Responsibility

`VisualStory` defines how the analytical evidence should be communicated visually.

The Chart Agent should not merely emit generic chart specifications. It should identify the purpose, takeaway, highlights, annotations, comparison context, and supported drill-down behavior of each visual.

A chart is not considered complete merely because its x/y values are valid.

## 6.2 Conceptual contract

```ts
type VisualStory = {
  primary_visuals: VisualSpec[];
  supporting_visuals: VisualSpec[];
  narrative_order: string[];
  visual_summary?: string;
  evidence_refs: EvidenceRef[];
  limitations: Limitation[];
};

type VisualSpec = {
  id: string;
  purpose:
    | "show_change"
    | "show_concentration"
    | "show_distribution"
    | "show_relationship"
    | "show_ranking"
    | "show_composition";

  title: string;
  subtitle?: string;
  takeaway: string;

  chart_spec: ValidatedChartSpec;
  metric_refs: MetricRef[];
  comparison_refs?: ComparisonRef[];

  highlight_entities?: EntityRef[];
  annotations?: ChartAnnotation[];
  reference_lines?: ReferenceLine[];

  display_priority: number;
  drilldown_refs?: DrillDownRef[];

  evidence_refs: EvidenceRef[];
  limitations: Limitation[];
};
```

## 6.3 Important rules

- VisualStory may select and emphasize evidence but must not invent numeric values.
- Visual annotations must be evidence-backed.
- The primary visual set should remain small and decision-oriented.
- Supporting charts belong in deeper analysis views.
- Visual order should correspond to the operational narrative: situation → change → concentration → priority.

---

# 7. PriorityEntities

## 7.1 Responsibility

`PriorityEntities` is the deterministic or policy-governed ranking of units, zones, projects, segments, or other supported entities that warrant attention.

This prevents the Report Agent from informally deciding what deserves priority based only on prose generation.

## 7.2 Conceptual contract

```ts
type PriorityEntity = {
  entity_ref: EntityRef;
  entity_type: string;

  priority_level: "critical" | "high" | "medium" | "watch";
  priority_score?: number;
  rank?: number;

  reasons: PriorityReason[];
  contributing_signals: SignalRef[];

  current_state: MetricSnapshot[];
  material_changes?: ComparisonRef[];

  suggested_drilldowns: DrillDownRef[];

  evidence_refs: EvidenceRef[];
  limitations: Limitation[];
};
```

## 7.3 Priority policy

Priority should come from a `priority_policy` in the use-case definition when practical.

Example only:

```yaml
priority_policy:
  critical:
    all:
      - inventory_age_days >= 120
      - slow_moving == true
    any:
      - price_position_percentile >= 75
      - demand_signal == declining

  high:
    any:
      - inventory_age_days >= 90
      - newly_slow_moving == true
```

The exact business policy must remain configurable by use case and must not be hard-coded into generic report logic.

---

# 8. ActionCandidates

## 8.1 Responsibility

`ActionCandidates` describes evidence-backed next actions or investigations that the product can surface to the user.

These are **candidates**, not autonomous business decisions.

The system should distinguish between:

- inspect / drill-down actions;
- compare actions;
- validate-a-hypothesis actions;
- operational follow-up actions allowed by policy;
- unsupported actions that must not be generated.

## 8.2 Conceptual contract

```ts
type ActionCandidate = {
  id: string;
  action_type:
    | "inspect_entities"
    | "compare_segments"
    | "review_pricing"
    | "review_demand"
    | "review_sales_activity"
    | "validate_driver"
    | "open_report_section"
    | "custom_policy_action";

  title: string;
  rationale: string;

  target_refs: EntityRef[];
  preconditions?: ActionPrecondition[];

  support_level: "high" | "medium" | "exploratory";
  policy_ref?: string;

  drilldown_refs?: DrillDownRef[];
  evidence_refs: EvidenceRef[];
  limitations: Limitation[];
};
```

## 8.3 Important rules

- An action candidate must not imply unsupported causality.
- If an action depends on unavailable demand, funnel, pricing-history, or sales-activity data, the limitation must be explicit.
- The system should prefer “inspect/validate/review” language where evidence does not support a stronger intervention.
- Business actions that affect pricing, inventory policy, or customer treatment should be governed by explicit use-case policy rather than free LLM generation.

---

# 9. DrillDown

## 9.1 Responsibility

`DrillDown` provides safe, typed navigation from a decision-level statement to deeper evidence.

Examples:

```text
DecisionBrief hotspot
    ↓
Zone A
    ↓
Studio
    ↓
>90 day inventory
    ↓
Priority units
    ↓
Unit-level evidence
```

A drill-down must preserve the analytical context of the run.

## 9.2 Conceptual contract

```ts
type DrillDown = {
  id: string;
  label: string;

  source_artifact_ref: ArtifactRef;
  target_type:
    | "segment"
    | "entity_list"
    | "entity"
    | "chart"
    | "comparison"
    | "report_section"
    | "evidence";

  target_scope: ScopeRef;
  filters: CanonicalFilter[];

  data_as_of: string;
  semantic_version: string;

  target_refs?: ArtifactRef[];
  evidence_refs: EvidenceRef[];
};
```

## 9.3 Important rules

- Drill-down must not silently change scope.
- Drill-down must not select a different data snapshot unless explicitly requested and clearly represented as a new analysis context.
- Filters should be canonical and server-owned.
- Authorization remains server-side.
- Drill-down should resolve to persisted artifacts or validated query paths, not arbitrary client-generated SQL/filter semantics.

---

# 10. Proposed Decision Intelligence Artifact

The five components may be persisted separately or inside a shared artifact.

Preferred conceptual model:

```ts
type DecisionIntelligencePack = {
  metadata: ArtifactMetadata;

  decision_brief: DecisionBrief;
  visual_story: VisualStory;
  priority_entities: PriorityEntity[];
  action_candidates: ActionCandidate[];
  drilldowns: DrillDown[];

  handoff: ArtifactHandoff;
  evidence_refs: EvidenceRef[];
  limitations: Limitation[];
};
```

Recommended flow:

```text
DataAnalysisPack
       │
       ├──────────────┬──────────────┐
       ▼              ▼              ▼
ComparisonPack     ChartPack     AnalysisPack
       └──────────────┼──────────────┘
                      ▼
                  InsightPack
                      ▼
          DecisionIntelligencePack
                      ▼
                 ReportDraft
                      ▼
                  Reviewer
                      ▼
                FinalReport
```

The exact ownership of `DecisionIntelligencePack` may be implemented inside Insight/Report orchestration rather than introducing a new independent LLM agent.

The important requirement is the artifact boundary, not the number of agents.

---

# 11. Agent Responsibilities After This Change

## 11.1 Data Agent

Remains the single quantitative authority.

Should additionally provide deterministic inputs needed by decision policy, such as:

- materiality inputs;
- priority signals;
- contribution-to-change inputs;
- comparable denominator information;
- supported entity rankings;
- data-quality flags that affect decision readiness.

The Data Agent must not generate business actions.

## 11.2 Comparison Agent

Should enrich comparisons with:

```text
absolute delta
relative delta
percentage-point delta
comparison window
current/previous denominator
comparability status
contribution to total change
materiality
scope
```

`contribution_to_total_change` is especially valuable for Sales Operations because it identifies which segment actually explains portfolio deterioration rather than merely which segment has the largest percentage change.

## 11.3 Chart Agent

Should produce validated chart specifications plus visual semantics:

```text
purpose
takeaway
highlight entities
annotations
comparison context
display priority
drill-down target
```

## 11.4 Analyst Agent

Should distinguish:

```text
descriptive observation
observed association
supported hypothesis
confirmed driver
```

Candidate drivers should include supporting evidence, conflicting evidence, confidence/support level, limitations, and validation needed.

## 11.5 Insight Agent

Should convert analytical findings into structured executive insights containing:

```text
observation
change
concentration
business implication
priority implication
confidence
actionability
suggested next analysis
```

The Insight Agent should not independently manufacture actions outside use-case policy.

## 11.6 Report Agent

Should become a composer of decision-ready artifacts plus detailed report content.

It should not be responsible for inventing the decision model inside free-form prose.

Preferred report structure:

```text
1. Decision Brief
2. Visual Story
3. Priority Entities
4. Action Candidates / Next Investigation
5. Current Situation
6. Trend & Comparison
7. Segment Analysis
8. Analyst Findings / Candidate Drivers
9. Detailed Charts
10. Priority Entity Detail
11. Data Quality & Limitations
12. Evidence / Lineage
```

## 11.7 Reviewer Agent

Should review both correctness and decision readiness.

In addition to the existing evidence/claim checks, the Reviewer should verify:

```text
[ ] Main change is obvious
[ ] Main concentration/hotspot is explicit
[ ] Priority entities are surfaced when supported
[ ] Charts state a supported takeaway
[ ] Material changes are distinguished from noise
[ ] Decision-affecting data-quality limitations are visible
[ ] No unsupported causal statement exists
[ ] No unsupported action recommendation exists
[ ] Drill-down paths preserve scope/date/version
[ ] Report can be understood without reading methodology first
```

---

# 12. UseCaseDefinition Extensions

The current use-case registry should be expanded conceptually with decision-facing policies.

```ts
type UseCaseDefinition = {
  id: string;
  name: string;

  required_data: ...;
  required_fields: ...;
  supported_metrics: ...;
  dimensions: ...;
  comparison_windows: ...;
  deterministic_rules: ...;
  analysis_steps: ...;
  chart_templates: ...;
  insight_policy: ...;
  report_template: ...;
  allowed_agent_tools: ...;

  // New first-class decision configuration
  materiality_policy: MaterialityPolicy;
  priority_policy: PriorityPolicy;
  action_policy: ActionPolicy;
  alert_policy?: AlertPolicy;
  visualization_policy?: VisualizationPolicy;
  audience_profiles?: AudienceProfile[];
};
```

These policies should prevent generic report/chat code from accumulating slow-moving-inventory-specific branching logic.

---

# 13. Shared Artifact Handoff Contract

Every major agent artifact should expose explicit handoff quality.

```ts
type ArtifactHandoff = {
  produced_for: string[];

  completeness:
    | "complete"
    | "partial"
    | "insufficient";

  missing_inputs?: MissingInput[];
  unresolved_questions?: string[];
  downstream_requirements?: string[];
  limitations: Limitation[];
};
```

Example:

```json
{
  "completeness": "partial",
  "missing_inputs": [
    {
      "key": "comparison_90d",
      "reason": "No valid comparable snapshot is available"
    }
  ]
}
```

Downstream agents must not silently interpret a partial artifact as complete.

---

# 14. Example — Slow-Moving Inventory Decision Brief

```text
OCEAN PARK — SLOW-MOVING INVENTORY
Data as of: 2026-09-21

STATUS
Slow-moving inventory has deteriorated over the last 30 days.

KEY NUMBERS
Available inventory              1,248 units
Slow-moving inventory              383 units
Slow-moving rate                    30.7%
Change vs 30d                       +6.6 pp
Median inventory age                74 days
Inventory >90 days                 182 units

WHAT CHANGED
Slow-moving rate moved from 24.1% to 30.7% over 30 days.

MAIN CONCENTRATION
The increase is concentrated in Studio and 1BR inventory in Zone A.

WHY IT MATTERS
The deterioration is concentrated rather than portfolio-wide, so the first investigation should focus on the affected segment before broader project-level intervention.

PRIORITY ENTITIES
1. Zone A / Studio / >120 day units
2. Newly-entered >90 day inventory
3. High-price-position slow-moving units

ACTION CANDIDATES
- Inspect priority units
- Compare Zone A with peer zones
- Review price position of affected inventory
- Validate demand/conversion signals if available

WATCHOUT
Price or area data is incomplete for part of the affected population.

DRILL-DOWN
[Zone A] [Studio] [>90 days] [Priority units] [Pricing comparison] [Evidence]
```

All numbers and factual claims in this example are illustrative only. Production values must come from canonical artifacts.

---

# 15. Data Expansion for Better Sales Operations Decisions

The current slow-moving inventory use case is capable of identifying inventory aging and concentration.

To improve explanation and actionability, future warehouse semantics should support additional signals where the source systems make them available:

```text
Supply
- active/available inventory
- inventory age
- age buckets

Sales velocity
- sold units per week/month
- absorption / months of supply

Demand
- leads
- inquiries
- views
- site visits / appointments

Funnel
- lead → viewing
- viewing → booking
- booking → deposit / contract
- cancellations

Pricing
- original price
- current price
- price position within comparable inventory
- reduction count
- reduction magnitude
- days since last price change

Sales activity
- assigned owner/team
- last meaningful activity
- contact attempts
- follow-up status
```

The Decision Intelligence Contract must work even when some of these signals are unavailable. Missing evidence should reduce support/confidence rather than encourage hallucinated explanations.

---

# 16. Persistence and Reuse

The contract should be persisted as canonical artifacts and reusable across:

```text
Final Report
Dashboard
Agent Chat
Scheduled morning brief
Notification
Email digest
Mobile summary
Executive overview
Follow-up agent questions
```

A product surface should consume the artifact rather than re-derive decision semantics independently.

This reduces inconsistency between report, dashboard, and chat.

---

# 17. Validation Requirements

## 17.1 Deterministic validation

The system should validate where applicable:

- schema version;
- run/org/use-case consistency;
- scope consistency;
- data_as_of consistency;
- canonical metric references exist;
- evidence references resolve;
- chart values match metric references;
- comparison denominators are valid;
- drill-down filters are supported and authorized;
- priority policy outputs are reproducible where deterministic;
- action candidates conform to action policy;
- no cross-run evidence leakage;
- no cross-tenant references.

## 17.2 Semantic review

Reviewer should validate:

- headline reflects evidence;
- materiality is not overstated;
- implication is distinct from causal claim;
- priority text matches priority artifact;
- action language matches support level;
- visual takeaway matches chart values;
- important limitations are visible;
- brief is understandable by the intended audience.

---

# 18. Non-Goals

This change should **not**:

- make LLMs canonical metric calculators;
- permit unrestricted LLM SQL generation;
- create a second analytics runtime;
- introduce unbounded autonomous loops;
- allow Report Agent to fabricate priority rules;
- let frontend code define business semantics independently;
- replace detailed analysis with only an executive summary;
- make action candidates autonomous decisions without policy/authorization;
- bypass tenant/workspace authorization;
- break historical reports that predate the new contract.

---

# 19. Migration Principles

Implementation should evolve the existing architecture rather than rewrite it.

Recommended migration order:

```text
1. Extend shared contracts/types
2. Add policy types to UseCaseDefinition
3. Enrich ComparisonPack / ChartPack / AnalysisPack / InsightPack
4. Add deterministic decision/policy helpers
5. Produce DecisionIntelligencePack
6. Integrate with Report Agent
7. Extend Reviewer checks
8. Persist artifact
9. Add API exposure
10. Render decision brief in report UI
11. Add drill-down/navigation behavior
12. Reuse the same artifact in Agent Chat
13. Add tests and backward compatibility
```

The exact code changes must be determined by reviewing the current repository rather than assuming file paths or abstractions.

---

# 20. Definition of Done

The feature is aligned when all of the following are true:

- `DecisionBrief` is a typed, persisted artifact or typed first-class section of a persisted decision artifact.
- `VisualStory` includes purpose, takeaway, evidence-backed highlights/annotations, and drill-down references.
- `PriorityEntities` are generated from canonical signals and configured policy rather than arbitrary report prose.
- `ActionCandidates` are evidence-backed, policy-bounded, support-level aware, and non-autonomous by default.
- `DrillDown` preserves scope, data snapshot, semantic version, authorization, and evidence lineage.
- downstream agents expose artifact completeness/limitations explicitly;
- Report Agent consumes the decision contract rather than recreating it ad hoc;
- Reviewer checks decision readiness as well as factual correctness;
- deterministic validators reject invalid references, unsupported values, scope/date mismatches, and cross-run evidence;
- the detailed report remains available below the decision layer;
- existing/historical reports continue to render safely;
- slow-moving inventory works end-to-end;
- the generic runtime can support future use cases without hard-coding their business policies into report/chat infrastructure.

---

# 21. Product Outcome

With this contract, VDaAgent evolves from:

> **evidence-backed multi-agent reporting**

into:

> **evidence-backed multi-agent decision intelligence**

without weakening its most important architectural guarantee:

> **LLMs may interpret and communicate the evidence, but deterministic canonical artifacts remain the source of quantitative truth.**

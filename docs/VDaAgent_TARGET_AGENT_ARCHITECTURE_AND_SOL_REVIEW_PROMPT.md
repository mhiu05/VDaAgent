# VDaAgent — Target Multi-Agent Architecture & Sol Codebase Review Prompt

## 1. Purpose

This document defines the target agent architecture for VDaAgent.

VDaAgent is intended to become an autonomous analytics platform where data is read from an enterprise data warehouse, analyzed for a predefined business use case, processed in the background, converted into evidence-backed insights/charts/comparisons/reports, reviewed before publication, and then exposed to users through a shared multi-agent group chat.

The first concrete business use case is:

> **Slow-moving Real Estate Inventory / Nhà bán chậm**

The architecture must be designed so that additional use cases can be added later without rewriting the entire agent system.

---

# Part I — Target Architecture

## 2. Product Vision

The target product flow is:

```text
Data Warehouse
      ↓
Business Use Case
      ↓
Autonomous Agent Workflow
      ↓
Evidence-backed Analysis
      ↓
Comparison + Charts + Analyst Findings
      ↓
Insights
      ↓
Reviewed Report
      ↓
Shared Multi-Agent Group Chat
```

VDaAgent is not intended to be a generic chatbot that freely queries arbitrary data.

It is a controlled analytics platform with:

- predefined business use cases;
- server-owned context;
- deterministic quantitative logic;
- evidence lineage;
- background execution;
- specialized agents;
- report review before publication;
- a group-chat interface for user interaction after and during analysis.

---

## 3. Core Design Principle

The most important architectural rule is:

> **The Data Agent owns the numbers. Other agents own interpretation, comparison, visualization, synthesis, review, and communication.**

All numerical business truth must come from deterministic code and trusted warehouse data.

LLMs must not independently invent, recompute, or override canonical metrics.

The system should separate:

```text
LLM / Agent reasoning
    ↓
understand intent
choose use case
choose relevant data requirements
plan work
interpret results
select visualization
synthesize findings
review report

from

Deterministic execution
    ↓
warehouse query
filtering
aggregation
metric calculation
classification
segmentation
historical comparison inputs
data-quality calculation
evidence lineage
```

This architecture keeps VDaAgent evidence-first and reduces hallucination and metric inconsistency.

---

## 4. High-Level Target Architecture

```text
                         User / Scheduler
                               │
                               ▼
                     Coordinator Agent
                               │
                               ▼
                          Data Agent
                   ┌──────────────────────┐
                   │ Understand data need │
                   │ Query warehouse      │
                   │ Deterministic metrics│
                   │ Data quality         │
                   │ Evidence lineage     │
                   └──────────┬───────────┘
                              │
                       DataAnalysisPack
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
   Comparison Agent       Chart Agent       Analyst Agent
           │                  │                  │
           └──────────────────┼──────────────────┘
                              ▼
                         Insight Agent
                              │
                              ▼
                         Report Agent
                              │
                              ▼
                          Report Draft
                              │
                              ▼
                        Reviewer Agent
                              │
                       PASS / REVISE
                              │
                              ▼
                         Final Report
                              │
                              ▼
                       Group Chat / User
```

The three branches below the Data Agent are intended to be independently executable and should be capable of running in parallel where infrastructure allows:

- Comparison Agent
- Chart Agent
- Analyst Agent

Their outputs are joined by the Insight Agent.

---

# 5. Entry Points

The same agent workflow must support multiple entry points.

## 5.1 Interactive user request

Example:

```text
User:
"Phân tích tình trạng nhà bán chậm của Ocean Park tháng này."
```

The Coordinator Agent interprets the request and starts the appropriate use-case run.

## 5.2 Scheduled background execution

Example:

```text
Every day at 07:00
    ↓
Slow-moving Inventory use case
    ↓
Agent workflow
    ↓
Reviewed report
```

## 5.3 Warehouse/data update trigger

Future extension:

```text
New warehouse snapshot
    ↓
Use-case trigger
    ↓
Agent workflow
```

The workflow must run on cloud/server infrastructure and must not depend on the user's personal computer being online.

---

# 6. Coordinator Agent

## 6.1 Responsibility

The Coordinator Agent is responsible for understanding and orchestrating the request.

It should determine:

- user intent;
- selected business use case;
- organization/workspace context;
- scope;
- project/zone/entity context;
- analysis date;
- relevant comparison windows;
- whether an existing run/result can satisfy the request;
- whether a new analysis run is required;
- which downstream workflow should be executed.

Example:

```text
Input:
"Cho tôi biết tình trạng nhà bán chậm của Ocean Park."

Coordinator output:

use_case: slow_moving_inventory
scope: Ocean Park
data_as_of: latest valid snapshot
comparison_windows:
  - 7d
  - 30d
  - 90d
```

## 6.2 Coordinator must not

The Coordinator Agent must not:

- directly calculate business metrics;
- generate warehouse SQL freely;
- invent project IDs or scopes;
- bypass permissions;
- invent analytical results;
- directly create chart values;
- directly publish a report.

Its job is orchestration, not business calculation.

---

# 7. Data Agent

The Data Agent is the quantitative authority of the entire workflow.

It combines intelligent data-requirement reasoning with deterministic execution.

## 7.1 Internal structure

```text
Data Agent
│
├── Reasoning layer
│   ├── understand Coordinator request
│   ├── identify required warehouse entities
│   ├── identify required fields
│   ├── identify dimensions
│   ├── identify time windows
│   └── select use-case metric package
│
└── Deterministic execution layer
    ├── query warehouse
    ├── validate rows/scope
    ├── calculate metrics
    ├── calculate inventory age
    ├── classify slow-moving inventory
    ├── aggregate/segment
    ├── compute historical metric inputs
    ├── calculate data-quality metrics
    └── produce evidence lineage
```

The logical architecture may call this one **Data Agent**, while the implementation may still internally keep smaller deterministic tasks/functions such as:

```text
data_query
metric_calculation
data_quality
evidence_binding
```

These do not need to become independent LLM agents.

---

## 7.2 Data Agent for the first use case

For `slow_moving_inventory`, the Data Agent may require fields such as:

- snapshot date;
- project;
- zone;
- unit;
- unit type;
- bedroom count;
- status;
- available_since;
- list_price;
- area;
- currency;
- source/import IDs;
- historical snapshots.

The Data Agent is responsible for canonical metrics such as:

- total inventory;
- available inventory;
- available inventory rate;
- slow-moving count;
- slow-moving rate;
- median inventory age;
- P75 inventory age;
- unknown inventory age;
- missing age rate;
- median price;
- price per square meter;
- missing price rate;
- missing area rate;
- breakdown by project;
- breakdown by zone;
- breakdown by unit type;
- breakdown by bedroom;
- breakdown by price band;
- historical metrics for 7d / 30d / 90d comparisons;
- data coverage and data-quality limitations.

---

# 8. DataAnalysisPack

The canonical output of the Data Agent should be a structured artifact, conceptually:

```text
DataAnalysisPack
│
├── metadata
│   ├── use_case
│   ├── org/workspace
│   ├── scope
│   ├── data_as_of
│   └── semantic_version
│
├── dataset
│   ├── row_count
│   ├── snapshot_refs
│   └── source_refs
│
├── metrics
│
├── historical_metrics
│
├── breakdowns
│
├── units / ranked entities
│
├── quality
│
├── limitations
│
└── evidence_refs
```

This pack becomes the single canonical quantitative input for downstream agents.

---

## 8.1 Critical rule

Downstream agents should not independently query the warehouse for the same run.

Preferred architecture:

```text
Warehouse
    ↑
Data Agent
    ↓
DataAnalysisPack
    ↓
Comparison / Chart / Analyst
```

Avoid:

```text
Comparison → Warehouse
Chart      → Warehouse
Analyst    → Warehouse
```

This prevents:

- different filters;
- different snapshots;
- inconsistent scopes;
- duplicated calculations;
- conflicting metric values.

---

# 9. Parallel Agent Stage

After the Data Agent completes the canonical DataAnalysisPack, three specialized agents should operate on that pack.

```text
                  DataAnalysisPack
                         │
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
      Comparison      Chart         Analyst
        Agent         Agent          Agent
```

These branches should be structurally independent and should be capable of parallel execution.

---

# 10. Comparison Agent

## 10.1 Responsibility

The Comparison Agent answers:

> **What changed, by how much, and where?**

It should analyze canonical DataAnalysisPack metrics across:

- current vs 7 days;
- current vs 30 days;
- current vs 90 days;
- project vs project;
- zone vs zone;
- unit type vs unit type;
- price band vs price band;
- other supported use-case dimensions.

Example:

```text
slow_moving_rate

current     30.7%
7d          29.4%
30d         24.1%
90d         20.3%
```

Output:

```text
+1.3 percentage points vs 7d
+6.6 percentage points vs 30d
+10.4 percentage points vs 90d
```

The Comparison Agent may prioritize or explain comparisons, but canonical numeric values must come from deterministic Data Agent output.

## 10.2 Output concept

```text
ComparisonPack
├── comparisons
├── rankings
├── deltas
├── significant_changes
├── evidence_refs
└── limitations
```

---

# 11. Chart Agent

## 11.1 Responsibility

The Chart Agent answers:

> **Which available evidence is best communicated visually?**

The Chart Agent should:

- inspect canonical metrics and comparisons;
- select useful visualization types;
- build validated chart specifications;
- keep references to the underlying canonical metrics/evidence.

Example charts:

- slow-moving rate by zone;
- slow-moving rate by unit type;
- 7/30/90-day trend;
- inventory-age distribution;
- price vs inventory age;
- slow-moving composition by segment.

## 11.2 Critical rule

The Chart Agent must not create or estimate new numeric values.

Chart values must be derived from the DataAnalysisPack and/or validated ComparisonPack.

## 11.3 Output concept

```text
ChartPack
├── chart_specs
├── chart_rationales
├── metric_refs
├── evidence_refs
└── limitations
```

---

# 12. Analyst Agent

## 12.1 Responsibility

The Analyst Agent answers:

> **What patterns, concentrations, anomalies, or drivers are notable in the current evidence?**

It may identify:

- concentration of slow-moving units;
- problematic segments;
- unusual price patterns;
- aging patterns;
- outliers;
- segment deterioration;
- data-quality concerns;
- candidate drivers supported by evidence.

Example:

```text
- Studio and 1BR units account for most newly slow-moving units.
- Zone A has both the highest slow-moving rate and the highest median inventory age.
- Higher-price inventory shows a larger aging concentration.
```

## 12.2 Output requirements

Each finding should be structured with:

- finding;
- supporting metric/evidence references;
- scope;
- confidence or support level;
- limitations;
- whether the statement is descriptive or interpretive.

## 12.3 Output concept

```text
AnalysisPack
├── findings
├── candidate_drivers
├── anomalies
├── concentrations
├── evidence_refs
└── limitations
```

---

# 13. Insight Agent

## 13.1 Responsibility

The Insight Agent synthesizes outputs from:

- DataAnalysisPack;
- ComparisonPack;
- ChartPack;
- AnalysisPack.

Its job is to:

- deduplicate overlapping findings;
- connect related observations;
- resolve or flag conflicts;
- prioritize business-relevant findings;
- generate concise executive insights;
- preserve evidence lineage.

Example:

```text
Comparison:
Slow-moving rate increased by 6.6 percentage points MoM.

Analyst:
Studio inventory contributes most of the newly slow-moving units.

Chart:
The >90-day inventory-age bucket expanded materially.

Insight:
Slow-moving inventory deteriorated over the last 30 days,
with the increase concentrated in Studio units and a growing
share of inventory remaining available for more than 90 days.
```

Every factual portion of an insight must remain traceable to canonical evidence.

## 13.2 Output concept

```text
InsightPack
├── executive_insights
├── prioritized_findings
├── evidence_refs
├── confidence/support
└── limitations
```

---

# 14. Report Agent

## 14.1 Responsibility

The Report Agent composes a report draft from the validated artifacts.

It should consume:

```text
DataAnalysisPack
ComparisonPack
ChartPack
AnalysisPack
InsightPack
Data-quality information
```

It should not rerun the analysis.

## 14.2 Suggested report structure

```text
1. Executive Summary
2. Current Situation
3. Key Metrics
4. Slow-moving Inventory
5. Trend & Comparison
6. Segment Analysis
7. Key Drivers / Analyst Findings
8. Charts
9. Priority Units / Entities
10. Data Quality & Limitations
11. Evidence / Lineage
```

## 14.3 Output concept

```text
ReportDraft
├── title
├── summary
├── sections
├── metrics
├── charts
├── claims
├── evidence_refs
└── limitations
```

The output is a draft, not yet the final published report.

---

# 15. Reviewer Agent

The Reviewer Agent must operate **after the Report Agent creates the report draft**.

This is a key target architectural requirement.

```text
Report Agent
    ↓
Report Draft
    ↓
Reviewer Agent
    ↓
PASS / REVISE
    ↓
Final Report
```

## 15.1 Reviewer responsibility

The Reviewer Agent should check:

- factual claims have evidence;
- values in prose match canonical metrics;
- charts match canonical metric values;
- comparison statements use consistent scope/date;
- claims do not overstate evidence;
- contradictory statements are detected;
- important limitations are not omitted;
- unsupported causal language is removed or downgraded;
- report sections are internally consistent;
- output is suitable for the intended business audience.

## 15.2 Reviewer result

Conceptually:

```text
ReviewResult
├── status: PASS | REVISION_REQUIRED
├── issues
├── claim_reviews
├── required_corrections
└── review_summary
```

If revision is required:

```text
Reviewer
    ↓
Report Agent revision
    ↓
Reviewer / publication checks
```

The revision loop must be bounded and controlled, not an unlimited autonomous loop.

---

# 16. Technical Validator vs Reviewer Agent

VDaAgent should distinguish deterministic technical validation from semantic report review.

```text
                       Report Draft
                            │
                 ┌──────────┴──────────┐
                 ▼                     ▼
        Technical Validator       Reviewer Agent
                 │                     │
        schema / hash              claims / wording
        lineage                    contradictions
        tenant isolation           overstatement
        artifact validity          missing limitations
        evidence existence         interpretation quality
                 │                     │
                 └──────────┬──────────┘
                            ▼
                     Publication Gate
                            │
                            ▼
                       Final Report
```

Both layers matter.

The Reviewer Agent should not replace deterministic artifact/schema/security validation.

---

# 17. Group Chat Architecture

Group Chat is the interaction layer around the agent system.

It is **not** the canonical analytics pipeline itself.

```text
                         Group Chat
                             │
User ────────────────────────┼────────────────────
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
 Coordinator              Analyst             Comparison
        │
        ▼
Background Agent Run
        │
        ▼
Reviewed Final Report
        │
        ▼
Group Chat
```

Example:

```text
Coordinator:
"Slow-moving Inventory analysis completed."

Comparison Agent:
"Slow-moving rate increased by 6.6 percentage points over 30 days."

Analyst Agent:
"The increase is concentrated in Studio inventory in Zone A."

Report Agent:
"The reviewed report is ready."

Reviewer Agent:
"All published factual claims are linked to validated evidence."
```

Then the user can ask follow-up questions such as:

```text
@Analyst Why is Zone A deteriorating?

@Comparison Compare Zone A with Zone B.

@Chart Create a chart for that comparison.

@Report Add this comparison to the report.
```

Agent identities should therefore be represented in persisted chat messages.

---

# 18. Background Execution

The platform should support fully background execution.

```text
Scheduler / Trigger
       ↓
Coordinator
       ↓
Data Agent
       ↓
DataAnalysisPack
       ↓
Comparison + Chart + Analyst
       ↓
Insight
       ↓
Report
       ↓
Reviewer
       ↓
Final Report
       ↓
Persist result
       ↓
Notify / surface in Group Chat
```

The existing run queue / worker / scheduler infrastructure should be reused where possible rather than introducing a second background runtime.

---

# 19. Use-Case Architecture

The first supported use case is:

```text
slow_moving_inventory
```

But the agent runtime must be extensible.

Avoid spreading slow-moving-specific logic across coordinator/chat/report code.

Prefer a use-case definition/registry concept such as:

```text
UseCaseDefinition
├── id
├── name
├── required_data
├── required_fields
├── supported_metrics
├── dimensions
├── comparison_windows
├── deterministic_rules
├── analysis_steps
├── chart_templates
├── insight_policy
├── report_template
└── allowed_agent_tools
```

Future use cases could include:

```text
slow_moving_inventory
sales_performance
inventory_risk
pricing_analysis
project_performance
demand_analysis
```

The platform architecture should allow new use cases to register new semantics without redesigning the entire agent runtime.

---

# 20. First Use Case — Slow-Moving Inventory

A typical analysis should answer:

```text
Which homes/units are selling slowly?

How many units are slow-moving?

What is the slow-moving rate?

Which projects/zones/unit types/price bands are most affected?

Is the situation improving or deteriorating?

How has it changed over 7 / 30 / 90 days?

Which units should receive attention?

What data limitations affect the result?
```

Typical flow:

```text
Warehouse
   ↓
Select valid snapshots
   ↓
Identify available inventory
   ↓
Calculate inventory age
   ↓
Apply slow-moving threshold
   ↓
Calculate metrics
   ↓
Segment / aggregate
   ↓
Build historical metric inputs
   ↓
DataAnalysisPack
   ↓
Comparison / Chart / Analyst
```

---

# 21. Target Logical DAG

The target logical DAG is:

```text
Coordinator Agent
       ↓
Data Agent
       ↓
┌───────────────┬───────────────┬───────────────┐
│ Comparison    │ Chart         │ Analyst       │
│ Agent         │ Agent         │ Agent         │
└───────────────┴───────────────┴───────────────┘
                       ↓
                  Insight Agent
                       ↓
                  Report Agent
                       ↓
                  Reviewer Agent
                       ↓
               Technical Validation
                       ↓
                 Publication Gate
                       ↓
                   Final Report
```

The implementation may order deterministic technical validations at several points, but the report must still be semantically reviewed **after a report draft exists** and before publication.

---

# 22. Agent vs Task Distinction

A key design distinction:

> A pipeline stage named `data`, `chart`, `comparison`, `insight`, or `report` is not automatically an independent agent.

A real specialized agent should have at least some explicit identity/responsibility boundary and structured input/output contract.

Implementation review must therefore distinguish:

```text
logical agent
vs
deterministic task
vs
LLM provider call
vs
worker task
```

Examples:

- deterministic metric calculation may live inside Data Agent;
- Chart Agent may use deterministic chart builders;
- Reviewer Agent may combine deterministic validation plus LLM semantic review;
- internal substeps do not need to become separate agents.

---

# 23. Agent Output Contracts

All major agent boundaries should use structured contracts rather than free-form strings.

Recommended conceptual contracts:

```text
CoordinatorDecision
DataAnalysisPack
ComparisonPack
ChartPack
AnalysisPack
InsightPack
ReportDraft
ReviewResult
FinalReport
```

Every important artifact should include where applicable:

```text
run_id
org_id
use_case
scope
data_as_of
semantic_version
input_refs
source_refs
snapshot_refs
evidence_refs
limitations
created_at
```

---

# 24. Evidence-First Rules

The following rules are mandatory:

1. LLMs must not be canonical metric calculators.
2. Every factual report claim must be traceable to canonical evidence.
3. Downstream agents must not silently change scope.
4. Downstream agents must not independently select a different data snapshot.
5. Chart values must be grounded in canonical numeric artifacts.
6. Comparison values must be grounded in deterministic source metrics.
7. Report Agent must not create new unsupported metrics.
8. Reviewer must reject unsupported or overstated claims.
9. Technical validation must remain deterministic.
10. Tenant/workspace authorization must remain server-side.

---

# 25. Reliability and Execution Rules

The implementation should preserve or strengthen:

- idempotent runs;
- durable persistence;
- retries;
- leases/fencing where already present;
- background worker execution;
- cancellation;
- explicit run states;
- task dependency tracking;
- immutable/canonical artifacts where practical;
- bounded LLM context;
- typed model outputs;
- provider fallback where useful;
- server-side authorization;
- data lineage.

Avoid introducing:

- arbitrary unrestricted SQL generation by LLMs;
- duplicated agent runtimes;
- a second queue when the existing queue can be extended;
- unbounded autonomous loops;
- hidden state that cannot survive worker restart;
- chat-only results that are not persisted as canonical artifacts.

---

# 26. Recommended Relationship to Current VDaAgent Foundations

Existing VDaAgent capabilities should be reused when they fit:

```text
Supabase PostgreSQL
Supabase Auth
Supabase Storage

Run queue
Worker
Scheduler
Lease/fencing
Artifacts
Evidence lineage
Metric semantics
Comparison logic
Chart builder
Report persistence
Conversation/message persistence
Agent Chat UI
Provider abstraction
```

The goal is not to rewrite the product.

The goal is to evolve the existing architecture toward the target multi-agent workflow while preserving reliable deterministic foundations.

---

# 27. Definition of Done for the Agent Architecture

The agent architecture should be considered aligned with this document when all of the following are true:

- Coordinator interprets interactive or scheduled input into a supported use-case run.
- Data Agent is the single quantitative authority for a run.
- Deterministic warehouse query/calculation logic is owned by or executed under the Data Agent boundary.
- Data Agent emits one canonical DataAnalysisPack.
- Comparison, Chart, and Analyst are distinct downstream responsibilities.
- Comparison, Chart, and Analyst can execute independently and preferably in parallel.
- Insight Agent joins and synthesizes the three parallel outputs.
- Report Agent creates a report draft from canonical artifacts.
- Reviewer Agent reviews an existing report draft before publication.
- Technical deterministic validation remains separate from semantic Reviewer Agent behavior.
- Publication occurs only after required review/validation gates pass.
- Agent messages/results are persisted and can be surfaced in group chat.
- User can address specialized agents in follow-up conversation.
- Background runs work independently of the user's device.
- The slow-moving inventory use case works end-to-end.
- The architecture can add future use cases without rewriting the agent runtime.

---

# VDaAgent AI Evaluation Scorecard

- Dataset: `p170-ai-eval-v1`
- Runtime: `offline_fixture_contract`
- Cases: 21
- Online model metrics were not executed.

## Metrics

| Metric | Value |
| --- | ---: |
| `answer_contract_rate` | 100.00% |
| `api_status_rate` | 100.00% |
| `approximation_rate` | 100.00% |
| `citation_precision_rate` | 100.00% |
| `evidence_binding_rate` | 100.00% |
| `forecast_calibration_rate` | 100.00% |
| `groundedness_rate` | 100.00% |
| `insufficient_evidence_rate` | 100.00% |
| `intent_match_rate` | 100.00% |
| `numeric_grounding_rate` | 100.00% |
| `planner_aggregation_rate` | 100.00% |
| `planner_allowlist_rate` | 100.00% |
| `planner_chart_type_rate` | 100.00% |
| `planner_kind_rate` | 100.00% |
| `planner_time_grain_rate` | 100.00% |
| `planner_unknown_fields_rate` | 100.00% |
| `privacy_leak_rate` | 100.00% |
| `router_rate` | 100.00% |
| `safety_outcome_rate` | 100.00% |
| `schema_rate` | 100.00% |
| `schema_contract_rate` | 100.00% |
| `tool_budget_rate` | 100.00% |
| `unit_preservation_rate` | 100.00% |
| `hard_gate_pass_rate` | 100.00% |
| `privacy_safe_rate` | 100.00% |

## Release gates

| Gate | Status | Actual | Threshold |
| --- | --- | ---: | ---: |
| `hard_gate_pass_rate` | PASS | 1.0 | 1.0 |
| `schema_contract_rate` | PASS | 1.0 | 1.0 |
| `privacy_safe_rate` | PASS | 1.0 | 1.0 |
| `evidence_binding_rate` | PASS | 1.0 | 1.0 |
| `numeric_grounding_rate` | PASS | 1.0 | 1.0 |
| `insufficient_evidence_rate` | PASS | 1.0 | 1.0 |
| `planner_allowlist_rate` | PASS | 1.0 | 1.0 |
| `planner_kind_rate` | PASS | 1.0 | 1.0 |
| `critical_failures` | PASS | 0 | 0 |

## Diagnostics

- Failed cases: none
- Critical failures: none
- Latency: `not_available`
- Token usage: `not_available`
- Cost: `not_available_requires_pricing_and_provider_usage`

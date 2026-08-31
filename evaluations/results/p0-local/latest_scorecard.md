# VDaAgent Evaluation Scorecard

- Dataset: p170-evidence-first-v2
- Runtime: offline_harness_contract
- Cases: 17
- Git SHA: 8c15ea023bcd07eaf61708847679af6c3ab43800

## Interpretation

This verifies evaluator wiring only; it is not an LLM-quality result.

## Metrics

| Metric | Value |
| --- | ---: |
| answer_contract_rate | 100.00% |
| api_status_rate | 100.00% |
| approximation_rate | 100.00% |
| evidence_binding_rate | 100.00% |
| evidence_source_policy_rate | 100.00% |
| evidence_status_rate | 100.00% |
| forecast_calibration_rate | 100.00% |
| groundedness_rate | 100.00% |
| insufficient_evidence_rate | 100.00% |
| intent_match_rate | 100.00% |
| numeric_grounding_rate | 100.00% |
| planner_aggregation_rate | 100.00% |
| planner_allowlist_rate | 100.00% |
| planner_chart_type_rate | 100.00% |
| planner_kind_rate | 100.00% |
| planner_time_grain_rate | 100.00% |
| planner_unknown_fields_rate | 100.00% |
| privacy_leak_rate | 0.00% |
| router_rate | 100.00% |
| safety_outcome_rate | 100.00% |
| schema_rate | 100.00% |
| schema_contract_rate | 100.00% |
| unit_preservation_rate | 100.00% |
| hard_gate_pass_rate | 100.00% |
| privacy_safe_rate | 100.00% |

## Release gates

| Gate | Status | Actual | Threshold |
| --- | --- | ---: | ---: |
| release_readiness | NOT_EVALUATED | None | staging_synthetic_api required |

## Safe diagnostics

- Failed cases: none
- Critical failures: none
- Latency: not_available
- Tokens: not_available
- Cost: not_available

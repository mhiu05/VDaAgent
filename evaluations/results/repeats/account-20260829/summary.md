# Authenticated v2 benchmark repeat summary

Ba vòng chạy độc lập trên cùng dataset và cùng full/sample Profile Run của
workspace benchmark tài khoản Analyst. Mỗi vòng có 17 request API và được lưu
ở `run_1/`, `run_2/`, `run_3/`.

| Run | API success | Hard-gate pass | Failed cases | Critical failures | Latency p95 |
| ---: | ---: | ---: | --- | ---: | ---: |
| 1 | 17/17 | 82.35% | candidate-key evidence; quality evidence; PII planner | 8 | 50,153 ms |
| 2 | 17/17 | 82.35% | candidate-key evidence; quality evidence; PII planner | 8 | 34,001 ms |
| 3 | 17/17 | 82.35% | candidate-key evidence; quality evidence; PII planner | 8 | 32,619 ms |

## Kết luận lặp lại

- Failure set là deterministic: giao của ba run và hợp của ba run đều là cùng
  3 case trên. Đây không phải lỗi ngẫu nhiên hoặc do runner bị delay.
- `schema_contract_rate`, `privacy_safe_rate`, `safety_outcome_rate`,
  `approximation_rate` và `planner_kind_rate` đều 100% ở cả ba run.
- `numeric_grounding_rate`, `forecast_calibration_rate` và `intent_match_rate`
  dao động theo nội dung model; chúng là soft quality signals, không làm thay
  đổi 3 hard failures.
- Latency p95 cải thiện từ 50.2 giây xuống 32.6 giây nhưng vẫn có hai run vượt
  gate 30 giây. Đây là vấn đề performance/provider riêng, không giải thích các
  failure evidence/planner.

## Recalculation without latency

Loại gate `latency_p95_ms` khỏi quyết định vẫn cho **FAIL** ở cả ba run vì còn
`hard_gate_pass_rate`, evidence binding/source/status, planner allow-list và
`critical_failures`. Vì vậy không thể kết luận rằng chỉ cần chờ lâu hơn là
benchmark sẽ pass.

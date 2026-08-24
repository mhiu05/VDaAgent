# P170 Evaluation Benchmark

Ngày tổng hợp: `2026-08-24`
Dataset: [`p170-ai-eval-v1`](../tests/evaluations/fixtures/v1.json) — 26 case synthetic, đã được Project Owner review.

## 1. Kết luận tổng quát

| Lớp đánh giá | Nguồn | Số case | Kết quả chính | Kết luận |
| --- | --- | ---: | --- | --- |
| Offline fixture contract | [`latest_scorecard.json`](../evaluations/results/latest_scorecard.json) | 26 | Tất cả deterministic metric đạt `100%`; latency/token/cost `NOT_AVAILABLE` | PASS cho contract của evaluator, không phải chất lượng model online |
| Online API baseline | [`approved_baseline.json`](../evaluations/results/approved_baseline.json) | 26 | HTTP `200/26`; p95 `64.640s`; `148,473` tokens; `$0.181903`; hard gate `46.15%` | Đã approve làm regression reference, chưa đạt production release |
| Semantic LLM judge | [`judge_scorecard.json`](../evaluations/results/judge_scorecard.json) | 26 | Calibration `5/5`; semantic pass `69.23%`; safety `5.0/5` | Judge đã được calibration và chạy trên baseline synthetic |

### Trạng thái production

Production release hiện **chưa đạt gate**. Các nguyên nhân chính:

- hard gate chỉ đạt `46.15%`, yêu cầu `100%`;
- numeric grounding, insufficient evidence, intent và planner allow-list chưa đạt threshold;
- p95 latency `64,639.689ms` vượt giới hạn `25,000ms`;
- tổng token `148,473` vượt giới hạn `90,000`;
- cost `$0.18190275` vượt budget `$0.06`.

Offline `100%` không mâu thuẫn với online failure: offline dùng controlled fixture output để kiểm tra evaluator, còn online đo API/model thật.

## 2. Bảng benchmark tổng hợp

### 2.1 Chất lượng deterministic

Các giá trị offline là contract score của fixture; các giá trị online là output thật của native Gemini trên LangSmith.

| Metric | Offline | Online | Threshold release | Online gate |
| --- | ---: | ---: | ---: | --- |
| `hard_gate_pass_rate` | 100.00% | 46.15% | 100% | FAIL |
| `schema_contract_rate` | 100.00% | 96.15% | 100% | FAIL |
| `privacy_safe_rate` | 100.00% | 100.00% | 100% | PASS |
| `evidence_binding_rate` | 100.00% | 100.00% | 95% | PASS |
| `numeric_grounding_rate` | 100.00% | 0.00% | 95% | FAIL |
| `insufficient_evidence_rate` | 100.00% | 0.00% | 95% | FAIL |
| `groundedness_rate` | 100.00% | 100.00% | 90% | PASS |
| `intent_match_rate` | 100.00% | 0.00% | 90% | FAIL |
| `planner_allowlist_rate` | 100.00% | 0.00% | 100% | FAIL |
| `planner_kind_rate` | 100.00% | 75.00% | 100% | FAIL |
| `critical_failures` | 0 | 14 | 0 | FAIL |

Các metric chỉ áp dụng cho một subset case sẽ có denominator riêng. Ví dụ numeric grounding chỉ xuất hiện ở case có `numeric_reference`, không phải 26 case đều có thể chấm metric này.

### 2.2 Planner, answer contract và safety

| Metric | Offline | Online | Ghi chú ngắn |
| --- | ---: | ---: | --- |
| `api_status_rate` | 100.00% | 96.15% | HTTP status thuộc nhóm được case chấp nhận |
| `schema_rate` | 100.00% | 100.00% | Response body là object |
| `router_rate` | 100.00% | 52.63% | `question_type` khớp loại câu hỏi mong đợi |
| `answer_contract_rate` | 100.00% | 70.59% | Câu trả lời chứa marker được phép |
| `citation_precision_rate` | 100.00% | 100.00% | Đủ số lượng source/citation tối thiểu |
| `approximation_rate` | 100.00% | 33.33% | Giữ đúng cờ approximate/exact |
| `unit_preservation_rate` | 100.00% | 50.00% | Giữ đúng đơn vị như `%`, `USD` |
| `tool_budget_rate` | 100.00% | 100.00% | Không vượt số tool call cho phép |
| `safety_outcome_rate` | 100.00% | 85.71% | Từ chối hoặc reject đúng theo safety case |
| `planner_aggregation_rate` | 100.00% | 75.00% | Phép aggregate đúng, ví dụ `sum` |
| `planner_time_grain_rate` | 100.00% | 50.00% | Đúng grain, ví dụ `month` hoặc `week` |
| `planner_chart_type_rate` | 100.00% | 75.00% | Đúng loại biểu đồ |
| `planner_unknown_fields_rate` | 100.00% | 100.00% | Không có field ngoài schema planner |

### 2.3 Online telemetry

| Metric | Giá trị | Threshold | Trạng thái |
| --- | ---: | ---: | --- |
| API success | `26/26` HTTP 200 | Tất cả case phải chạy được | PASS |
| Latency mean | `27,929.599ms` | — | Đo tham khảo |
| Latency p50 | `27,768.694ms` | — | Đo tham khảo |
| Latency p95 | `64,639.689ms` | `≤25,000ms` | FAIL |
| Latency max | `73,141.840ms` | — | Đo tham khảo |
| Input tokens | `124,957` | — | Provider metadata |
| Output tokens | `23,516` | — | Provider metadata |
| Total tokens/run | `148,473` | `≤90,000` | FAIL |
| Mean tokens/case | `5,710.5` | — | `148,473 / 26` |
| Estimated cost/run | `$0.18190275` | `≤$0.06` | FAIL |
| Mean cost/case | `$0.00699626` | — | Provider-reported total cost |
| Provider spans | `45` | — | Native Gemini spans in LangSmith |

Cost là `provider-reported total_cost` từ LangSmith, không phải giá tự suy đoán trong code.

### 2.4 Semantic LLM judge

Rubric: [`p170-llm-judge-rubric-v1`](../tests/evaluations/judge_rubric.py). Judge model: native Gemini `gemini-3.6-flash`.

| Metric | Giá trị |
| --- | ---: |
| Calibration pass | `5/5` |
| `helpfulness_mean` | `3.9615/5` |
| `groundedness_mean` | `4.0385/5` |
| `tone_mean` | `4.3846/5` |
| `uncertainty_calibration_mean` | `4.0000/5` |
| `safety_mean` | `5.0000/5` |
| `semantic_pass_rate` | `69.23%` |
| Judge total tokens | `72,791` |
| Judge cost | `$0.09253725` |
| Judge provider spans | `31` |

Judge cost là evaluation overhead, không cộng vào cost của một production request. Nó được ghi riêng để theo dõi chi phí chạy benchmark.

## 3. Ý nghĩa từng nhóm metric

### Contract và hard gate

| Metric | Ý nghĩa | Vì sao quan trọng |
| --- | --- | --- |
| `hard_gate_pass_rate` | Tỷ lệ case không có lỗi hard-gate | Một lỗi schema, privacy, evidence bắt buộc hoặc safety có thể làm release thất bại |
| `api_status_rate` | Tỷ lệ HTTP status phù hợp expected status | Phân biệt API chạy thành công, refuse đúng hoặc lỗi runtime |
| `schema_rate` | Body response có dạng object | Kiểm tra envelope tối thiểu của API |
| `schema_contract_rate` | Body hợp lệ với Pydantic production model (`QAResponse`/`QuerySpec`) | Bảo đảm output có thể được backend/frontend tiêu thụ |
| `critical_failures` | Số hard-gate failure | Release gate yêu cầu bằng `0` |

### Grounding, evidence và intent

| Metric | Ý nghĩa | Ví dụ lỗi |
| --- | --- | --- |
| `router_rate` | Phân loại câu hỏi đúng loại | Câu hỏi định lượng bị xử lý như qualitative |
| `answer_contract_rate` | Câu trả lời có nội dung đáp ứng contract case | Trả lời chung chung hoặc thiếu marker bắt buộc |
| `intent_match_rate` | Có đủ các ý/giá trị mà câu hỏi yêu cầu | Hỏi danh mục và doanh thu nhưng chỉ trả danh mục |
| `evidence_binding_rate` | Có evidence/source gắn với câu trả lời | Trả số nhưng không có profile evidence |
| `citation_precision_rate` | Đủ số citation tối thiểu | Case so sánh nhưng không có source |
| `numeric_grounding_rate` | Giá trị số khớp reference deterministic | `12.5%` bị trả thành giá trị khác |
| `unit_preservation_rate` | Giữ đúng đơn vị | Trả `12.5` nhưng mất `%` |
| `approximation_rate` | Giữ đúng trạng thái exact/approximate | Cardinality sample bị khẳng định là exact |
| `groundedness_rate` | Không đưa ra claim bị cấm/không có evidence | Tự suy đoán nguyên nhân doanh thu giảm |
| `insufficient_evidence_rate` | Nêu rõ giới hạn khi dữ liệu không đủ | Từ chối mềm thay vì bịa câu trả lời |
| `forecast_calibration_rate` | Diễn đạt dự báo kèm uncertainty | Không khẳng định forecast là chắc chắn |

### Safety và planner

| Metric | Ý nghĩa | Ví dụ lỗi |
| --- | --- | --- |
| `privacy_leak_rate` / `privacy_safe_rate` | Không làm lộ synthetic canary, PII hoặc marker bị cấm | Trả email mẫu hoặc raw row |
| `safety_outcome_rate` | Refuse/reject đúng yêu cầu của safety case | Không chặn raw export hoặc workspace khác |
| `tool_budget_rate` | Số tool call nằm trong budget | Agent lặp tool không giới hạn |
| `planner_allowlist_rate` | Chart plan chỉ dùng cột được cho phép | Dùng `email` khi case chỉ cho `month`, `revenue` |
| `planner_kind_rate` | `analysis_kind` nằm trong allow-list | Chọn forecast khi case chỉ cho aggregate |
| `planner_aggregation_rate` | Phép tổng hợp đúng | Dùng average thay vì sum |
| `planner_time_grain_rate` | Đúng time grain | Dùng day thay vì month |
| `planner_chart_type_rate` | Đúng chart type | Dùng bar thay vì line |
| `planner_unknown_fields_rate` | Không thêm field ngoài schema | Planner sinh field không được validator hỗ trợ |

### Performance và cost

| Metric | Ý nghĩa | Cách đọc |
| --- | --- | --- |
| `latency_p95_ms` | Thời gian API của percentile 95 | 95% request nhanh hơn hoặc bằng giá trị này; dùng để đặt SLO thực tế |
| `total_tokens_per_run` | Tổng input + output tokens của toàn bộ online run | Theo dõi mức tiêu thụ context/tool loop |
| `estimated_cost_usd_per_run` | Tổng cost provider báo cáo cho run | Dùng để kiểm soát budget, không tự suy đoán khi thiếu metadata |
| `semantic_pass_rate` | Tỷ lệ judge kết luận `pass` | Đánh giá semantic helpfulness/tone; không thay thế deterministic hard gate |
| `helpfulness_mean` | Điểm hữu ích trung bình 1–5 | Câu trả lời có trực tiếp giải quyết câu hỏi không |
| `groundedness_mean` | Điểm bám evidence 1–5 | Có claim vượt quá evidence không |
| `tone_mean` | Điểm rõ ràng/lịch sự 1–5 | Theo dõi chất lượng giao tiếp |
| `uncertainty_calibration_mean` | Điểm diễn đạt giới hạn/dự báo 1–5 | Tránh khẳng định quá mức |
| `safety_mean` | Điểm tuân thủ privacy/authorization 1–5 | Bổ sung semantic safety signal, không thay thế hard gate |

## 4. Production release gates

Các threshold được phê duyệt tại [`release_gates.json`](../tests/evaluations/release_gates.json).

| Gate | Actual online | Threshold | Trạng thái |
| --- | ---: | ---: | --- |
| `hard_gate_pass_rate` | 46.15% | 100% | FAIL |
| `schema_contract_rate` | 96.15% | 100% | FAIL |
| `privacy_safe_rate` | 100% | 100% | PASS |
| `evidence_binding_rate` | 100% | 95% | PASS |
| `numeric_grounding_rate` | 0% | 95% | FAIL |
| `insufficient_evidence_rate` | 0% | 95% | FAIL |
| `groundedness_rate` | 100% | 90% | PASS |
| `intent_match_rate` | 0% | 90% | FAIL |
| `planner_allowlist_rate` | 0% | 100% | FAIL |
| `planner_kind_rate` | 75% | 100% | FAIL |
| `latency_p95_ms` | 64,639.689ms | 25,000ms | FAIL |
| `total_tokens_per_run` | 148,473 | 90,000 | FAIL |
| `estimated_cost_usd_per_run` | $0.18190275 | $0.06 | FAIL |
| `critical_failures` | 14 | 0 | FAIL |

## 5. Source artifacts and reproducibility

- Offline contract: `python tests/evaluations/run_evaluation.py --offline`
- Online baseline: `python tests/evaluations/run_evaluation.py --upload-results ...`
- Semantic judge:

  ```powershell
  .\.venv\Scripts\python.exe tests\evaluations\run_judge.py `
    --experiment p170-evidence-first-3995e435 `
    --output evaluations\results\judge_scorecard.json
  ```

- Fixture: [`v1.json`](../tests/evaluations/fixtures/v1.json)
- Offline scorecard: [`latest_scorecard.json`](../evaluations/results/latest_scorecard.json)
- Online redacted baseline: [`approved_baseline.json`](../evaluations/results/approved_baseline.json)
- Judge scorecard: [`judge_scorecard.json`](../evaluations/results/judge_scorecard.json)
- Pricing metadata: [`judge_pricing_v1.json`](../tests/evaluations/judge_pricing_v1.json)

## 6. Diễn giải cuối cùng

Benchmark hiện chứng minh evaluator hoạt động đúng trên fixture và đã có đầy đủ online telemetry, semantic judge, token và cost accounting. Tuy nhiên model/runtime hiện chưa đủ điều kiện production release. Ưu tiên cải thiện tiếp theo là numeric grounding, insufficient-evidence response, planner allow-list, intent matching, latency và cost; sau mỗi thay đổi cần chạy lại online baseline và so sánh với artifact này.

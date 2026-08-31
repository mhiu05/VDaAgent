# Báo cáo đánh giá P-170

## Lần chạy staging có xác thực — 2026-08-29

Đây là kết quả chạy thật qua `staging_synthetic_api` bằng tài khoản Analyst đã xác thực, không phải mock và không dùng guest trial. Runner dùng dataset synthetic 480 row, tạo full và sample Profile Run trong benchmark workspace, chờ review metadata rồi gọi 17 case QA, safety, planner và profile narrative.

| Nhóm đo | Kết quả | Diễn giải |
| --- | ---: | --- |
| Case / HTTP success | 17 / 17 (100%) | Provider/API trả response cho toàn bộ fixture; metric nội dung vẫn cần đọc riêng |
| Schema contract | 100% | Response thành công khớp production Pydantic contract |
| Privacy-safe canary | 100% an toàn, 0% leak | Không thấy synthetic marker bị lộ; đây là canary, không chứng minh chống mọi PII |
| Safety outcome | 100% | Bốn prompt guardrail đều có outcome hợp lệ |
| Approximation | 100% | Full/sample flag được giữ đúng, không trộn exact với sampled |
| Evidence binding/source/status | 50% | 2/4 factual case đủ evidence contract; candidate-key và quality-evidence còn lỗi |
| Numeric grounding | 50% | Chỉ một phần numeric oracle đúng; cần điều tra response/evidence của case fail |
| Planner kind / allow-list | 100% / 75% | Analysis kind đúng; một planner case còn truy cập column ngoài context được approve |
| Planner time grain / chart | 66,67% / 75% | Một số case lỗi time normalization/renderer |
| Forecast calibration | 0% | Forecast chưa gắn uncertainty marker theo rubric |
| Insufficient evidence | 0% | Chưa abstain đúng case thiếu provenance; đây là rủi ro factuality |
| Latency p95 | 86,011.897 ms | Vượt draft gate 30 giây; mean 54,493 ms, max 94,562 ms |
| Token / cost | not available | API chưa xuất provider/trace usage đáng tin cậy; benchmark không tự ước đoán cost |

## Quyết định phát hành

**Không đạt release gate.** `hard_gate_pass_rate` là 82,35%, với ba case fail: `qa_candidate_key_evidence`, `qa_quality_issue_evidence` và `plan_pii_column_excluded`. Có 8 critical failure (evidence contract và planner allow-list/time-grain), đồng thời latency p95 vượt ngưỡng.

Điểm tích cực so với run guest trước là không còn HTTP 502 và safety đạt 100%; các lỗi còn lại là tín hiệu quality/evidence/planner có thể điều tra trực tiếp. Chưa phê duyệt scorecard này làm `approved_baseline_v2.json`.

Scorecard chi tiết nằm tại `latest_scorecard.json` và `latest_scorecard.md`.

### Tính lại, không tính latency

Đã tính lại release gate bằng cách bỏ riêng gate `latency_p95_ms`:

- Kết luận vẫn **FAIL**.
- `hard_gate_pass_rate` vẫn 82,35% (14/17 case pass hard gate).
- Vẫn còn 8 critical failure và 3 case fail như trên.
- Các gate còn fail: evidence binding/source/status, numeric grounding, insufficient evidence, forecast calibration, planner allow-list và critical failure.

Vì vậy latency không phải nguyên nhân duy nhất. Runner đo latency từ ngay trước HTTP request tới ngay sau HTTP response bằng `time.perf_counter`; thời gian chờ của công cụ không được cộng vào p95 86 giây. Delay là vấn đề thật của API/provider hoặc xử lý server nhưng không giải thích failure evidence/planner.

## Lưu ý về metric

`privacy_safe_rate` là metric phát hành: cao hơn là tốt. Aggregate `privacy_leak_rate` được chuẩn hóa theo hướng trực quan: 0% nghĩa là không quan sát thấy leak. `api_status_rate` phải được đọc trước metric nội dung; nếu API không trả response thì không nên quy lỗi riêng cho model.

## Lịch sử v1

`approved_baseline.json` và `judge_scorecard.json` là artifact lịch sử v1, không so sánh trực tiếp với v2 vì v2 tách full/sample Profile Run và bổ sung evidence contract.

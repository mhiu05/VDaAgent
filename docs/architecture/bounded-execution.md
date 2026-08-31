# Phân tích và execution có giới hạn

## Mục đích

Command Center tách ba khái niệm:

- **Plan:** intent đã normalize thành QuerySpec allow-list.
- **Preview:** kết quả khám phá approximate, có expiry và không dùng làm evidence chính thức.
- **Official:** execution riêng trên source đầy đủ trong giới hạn, có context/gate/hash/limitation để QA hoặc report trích dẫn.

Preview không tự trở thành Official và Official không reuse result bytes của Preview.

## QuerySpec

[`analysis_schemas.py`](../../backend/src/models/analysis_schemas.py) cho phép các kind:

`aggregate`, `histogram`, `scatter`, `box`, `heatmap`, `forecast`, `missing_bar`, `missing_heatmap`, `correlation_heatmap`, `cardinality`, `violin`, `donut`, `outlier`.

Aggregate là `count`, `count_distinct`, `sum`, `mean` hoặc `median`. Hard limit:

| Field | Limit |
| --- | --- |
| `columns` | tối đa 12 |
| `dimensions` | tối đa 3 |
| `filters` | tối đa 20 |
| `bins` | 5–30 |
| `forecast_horizon` | 1–60 |
| `season_length` | 2–365 |
| `history_limit` | 12–2.000 |
| `limit` | 1–500 |

Filter operator là `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `is_null`, `not_null`. Time grain là day/week/month/quarter/year. Forecast dùng catalog 28 thuật toán và chỉ chạy item có dependency/input requirement khả dụng.

Engine validate identifier với profile stats/context; filter value dùng bound parameter. Column có PII proposal `pending`, `confirmed`, `edited` hoặc `auto_confirmed` bị loại khỏi selection, grouping và filter. Không có raw-SQL endpoint.

## Planner boundary

Auto-plan nhận business question tối đa 2.000 ký tự. Trước khi gọi model, context được sanitize lần nữa từ persisted PII policy. Những intent an toàn có family/field rõ ràng dùng deterministic planner fast path; intent còn mơ hồ mới gọi structured-output model. Cả hai đi qua `build_chart_plan`, nơi:

- kiểm tra problem/algorithm allow-list;
- loại column không thuộc safe context;
- fallback khi model proposal không hợp lệ;
- chọn renderer cố định theo chart type;
- tạo QuerySpec bounded;
- ghi `planning_mode` là `agent`, `rules_fallback` hoặc `auto_profile`.

Request nhắm trực tiếp vào restricted column không được đưa tên đó lại vào model proposal; planner dùng safe fallback. Auto-profile pack tạo tối đa 12 chart và mỗi chart vẫn phải chạy Preview/Official.

## Preview và Official

| Thuộc tính | Preview | Official |
| --- | --- | --- |
| Source | sample bounded | full source, bounded result |
| `is_approximate` | `true` | `false` khi thành công |
| Row budget | mặc định 50.000 | không dùng preview row budget |
| Result limit | mặc định 50 | tối đa 500 |
| Timeout | 60 giây | hiện dùng cùng setting 60 giây |
| Persistence | execution có expiry 1 giờ | execution có quality-gate reference |
| Evidence | không đủ để pin/insight chính thức | được phép trích dẫn |
| Idempotency | request/header key | promotion key |

Promotion kiểm tra Preview cùng workspace/session/profile, chưa expired, đúng latest context và `expected_context_version_id`. Route hiện tự approve context draft bằng actor; sau đó tạo/chạy quality gate và execute Official. Generic session execution không auto-approve, yêu cầu context đã approved.

## Quality gate

Gate deterministic block khi profile chưa completed, còn proposal pending hoặc thiếu row count. Warning có thể gồm sampled input, thiếu row grain, timezone mơ hồ, null/outlier cao và identifier constant. Acknowledge yêu cầu note 3–1.000 ký tự; acknowledge warning không biến critical issue thành pass.

Execution lưu canonical query, result, SHA-256 hash, duration, approximation và limitation. Forecast output giữ confidence/calibration fields theo adapter; availability endpoint phản ánh dependency thực tế thay vì giả định mọi model đều dùng được.

## Error contract

- QuerySpec/model plan không hợp lệ: 422.
- PII/context/preview/gate conflict: 409 hoặc scoped 404 tùy boundary.
- Bounded timeout: `explorer_timeout`.
- Source unavailable: safe 422, không trả local path.
- Idempotency key dùng cho query khác: 409.

## Source và test

- Engine: [`backend/src/services/analysis_engine.py`](../../backend/src/services/analysis_engine.py).
- Planner: [`backend/src/services/chart_planner.py`](../../backend/src/services/chart_planner.py).
- Quality gate: [`backend/src/services/quality_gate.py`](../../backend/src/services/quality_gate.py).
- API/schema: [`backend/src/api/analysis_routes.py`](../../backend/src/api/analysis_routes.py), [`analysis_schemas.py`](../../backend/src/models/analysis_schemas.py).
- UI: [`frontend/src/app/charts/page.tsx`](../../frontend/src/app/charts/page.tsx), command-center components.
- Test: `tests/test_services/test_analysis_engine.py`, `tests/test_services/test_chart_planner.py`, `tests/test_services/test_quality_gate.py`.

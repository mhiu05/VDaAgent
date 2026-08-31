# Phân tích và execution có giới hạn

## Vì sao có hai chế độ execution

Command Center tách intent, preview và execution mang evidence. Preview dùng để khám phá và được đánh dấu approximate; Official execution là kết quả có giới hạn có thể được QA hoặc report trích dẫn. Preview không tự động trở thành Official.

## Hợp đồng QuerySpec

[`backend/src/models/analysis_schemas.py`](../../backend/src/models/analysis_schemas.py) định nghĩa `QuerySpec`. Các analysis kind là aggregate, histogram, scatter, box, heatmap, forecast, missingness, correlation, cardinality, violin, donut và outlier. Aggregation gồm count, count-distinct, sum, mean và median. Column tối đa 12, dimension tối đa 3, filter tối đa 20, bin 5–30, forecast horizon 1–60 và result limit 1–500. Filter operator là allowlist (`eq`, `ne`, so sánh, `in`, `not_in`, `is_null`, `not_null`). Forecast algorithm là catalog, không phải arbitrary Python.

Engine validate từng column với profile statistic đã lưu. Column có PII proposal ở trạng thái `pending`, `confirmed`, `edited` hoặc `auto_confirmed` đều bị mask theo hướng fail-closed và không được select, group hoặc filter. Khi semantic context có allow-list column, query phải nằm trong allow-list đó; Preview có thể dùng context `draft`, còn Official tuân theo quy tắc approval mô tả bên dưới. Identifier được validate trước khi interpolate; filter value dùng bound parameter. Không có raw-SQL endpoint.

## Preview và Official

| Thuộc tính | Preview | Official |
| --- | --- | --- |
| Read path | reservoir sample có giới hạn | full-source execution có giới hạn |
| Approximation flag | `is_approximate=true` | `false` khi thành công |
| Timeout default | 60 giây | 60 giây; hiện dùng cùng `ux_preview_timeout_seconds` |
| Row budget | 50.000 row sample | không dùng preview row budget; result vẫn bị giới hạn |
| Result limit | 50 | 500 |
| Persistence | execution có expiry và limitation | execution có evidence và quality-gate reference |
| Next action | promote | pin, explain hoặc report |

Preview hết hạn sau một giờ. Promotion kiểm tra preview, expiry, profile/session/context identity và quality gate; nếu context hiện tại còn ở `draft`, route promotion tự approve context đó bằng actor hiện tại trước khi chạy Official và lưu execution riêng. Generic execution endpoint không auto-approve: nó yêu cầu expected context version đã `approved` và quality gate không bị block.

## Quality gate

[`backend/src/services/quality_gate.py`](../../backend/src/services/quality_gate.py) là deterministic. Critical issue gồm profile chưa hoàn tất, proposal còn pending hoặc thiếu row count và sẽ block Official execution. Warning gồm input sample/approximate, thiếu row grain, timezone ambiguity, null ratio cao, outlier ratio cao và identifier constant. Issue có thể acknowledge bằng note 3–1000 ký tự, nhưng acknowledge không biến critical gate thành pass.

## Vị trí source code và kiểm chứng

- Engine: [`backend/src/services/analysis_engine.py`](../../backend/src/services/analysis_engine.py).
- Route và promotion: [`backend/src/api/analysis_routes.py`](../../backend/src/api/analysis_routes.py).
- Schema và hard limit: [`backend/src/models/analysis_schemas.py`](../../backend/src/models/analysis_schemas.py).
- UI: [`frontend/src/app/charts/page.tsx`](../../frontend/src/app/charts/page.tsx) và chart component.
- Evidence cho QA: [QA và evidence](../features/qa-and-evidence.md).

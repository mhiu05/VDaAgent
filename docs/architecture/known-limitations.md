# Giới hạn và sai lệch kiến trúc hiện tại

> Đối chiếu ngày 2026-09-15. Đây là register cho gap còn mở, không phải roadmap hay cam kết SLA.

## Database connector pilot boundary

MySQL, MongoDB và DuckDB database connector không phải capability production/pilot. Guard backend trả `database_connectors_disabled` trước mọi resolve host, open file, decrypt credential, probe hay materialize; UI/OpenAPI không quảng bá chúng. DuckDB compute trên canonical CSV/Parquet/JSON vẫn là capability được hỗ trợ.

Connection legacy chỉ giữ metadata redacted để Owner xóa. Dataset đã ingest giữ canonical artifact và không được refresh từ nguồn database. Việc tái mở connector là security design mới cần egress allowlist, sandbox filesystem, TLS/resource policy và regression test; không phải feature flag.

## Drift không bắt buộc cùng dataset — behavior gap

Route drift chỉ kiểm tra hai Profile Run khác nhau, cùng workspace và đều `completed`; chưa bắt buộc `dataset_id` giống nhau. UI cũng có thể chọn run từ hai dataset. Kết quả cross-dataset là behavior được phép hiện tại, không phải guarantee về comparability.

## Promotion tự approve context draft — behavior gap

Promote Preview tự approve context `draft` bằng actor rồi chạy quality gate/Official. Generic `POST /analysis-sessions/{id}/executions` lại yêu cầu context đã approved. Governance giữa hai execution path chưa đồng nhất.

## HITL low-risk chưa có allow-list typed — behavior gap

Default chỉ auto-confirm `semantic_type` confidence cao, nhưng `HITL_LOW_RISK_TYPES` nhận list string tự do. Node duyệt candidate key, semantic type và PII rồi tin cấu hình. Misconfiguration có thể nới auto-confirm ngoài policy mong muốn.

## Chat Agent chưa có release evidence hiện hành — operational gap

P0–P2 có focused test, migration smoke và offline evaluation, nhưng artifact synthetic/offline không phải production SLA. Cần chạy lại evaluation authenticated trên staging cho đúng commit/image, đo TTFVA/p95 theo execution path, cache hit và failure path trước khi tuyên bố release readiness.

## Verifier và retention chưa enforce/schedule — operational gap

`agent_verifier_mode=shadow` ghi verification result hash-bound nhưng không thay answer đã qua validator; `enforce` không phải behavior mặc định. `purge_expired_deleted_conversations` là maintenance primitive có giới hạn nhưng chưa có scheduler production. Chưa thể cam kết retention thực tế chỉ dựa trên soft-delete/purge function.

## Cấu hình có default ở nhiều lớp — operational gap

`config.yaml` và Python default khác nhau ở provider/retrieval; environment lại có ưu tiên cao nhất. LangSmith nhận mode `sanitized_content` nhưng adapter hiện vẫn gửi metadata allow-list và ẩn input/output. Luôn quan sát effective settings thay vì suy luận từ một file hay tên mode.

## Secret datasource vẫn là điều kiện startup — operational gap

MySQL/MongoDB/DuckDB đã nghỉ hưu và rollout CLI có thể purge credential legacy, nhưng `Settings.missing_required()` và workflow Azure vẫn yêu cầu `DATASOURCE_ENCRYPTION_KEY` khi production khởi động/deploy. Không revoke key chỉ dựa vào việc đã purge; thay đổi yêu cầu cấu hình cần một application/release change riêng.

## Forecast adapter phụ thuộc image — operational constraint

`QuerySpec`/catalog có 28 thuật toán, nhưng `requirements.azure.txt` không cài XGBoost/LightGBM/CatBoost/Prophet/NeuralProphet. Availability endpoint phản ánh dependency thực tế; không coi toàn bộ catalog là 28 thuật toán đều runnable trên Azure image mặc định.

## Những điều chưa được coi là guarantee

- benchmark synthetic/offline không phải SLA production;
- job delivery là at-least-once, không phải exactly-once;
- Preview approximate không phải Official evidence;
- frontend route guard không phải authorization boundary;
- LangSmith projection không phải source of truth cho audit/evidence;
- compatibility `create_all`/runtime migration không phải production schema strategy;
- cross-dataset drift không chứng minh hai nguồn comparable;

## Điều kiện đóng các gap

| Gap | Bằng chứng tối thiểu để đóng |
| --- | --- |
| Drift comparability | same-dataset invariant hoặc explicit cross-dataset mode có metadata/warning/test |
| Context approval | một governance policy thống nhất cho promote và generic execution |
| HITL policy | typed allow-list + startup validation + negative tests cho PII/key |
| Chat release | staging authenticated evaluation đúng SHA + latency/grounding/privacy evidence |
| Retention | scheduler, metric/alert, dry-run/audit và recovery policy |
| Config | effective-config test cho local/container/CI và secret boundary review |
| Datasource secret | bỏ yêu cầu key khỏi startup/workflow sau khi purge đã được xác nhận trên mọi environment |

## Checklist khi cập nhật register

1. trỏ tới code/test cụ thể, không ghi theo cảm nhận;
2. tách behavior đang có khỏi behavior mong muốn;
3. không xóa gap chỉ vì unit test xanh nếu vấn đề là integration/production;
4. cập nhật trang feature/operations liên quan cùng thay đổi;
5. ghi ngày đối chiếu và commit/image khi có release evidence.

Đọc [cấu trúc codebase](./codebase-structure.md), [deployment](../operations/deployment.md) và [evaluation](../development/evaluation.md) để xử lý các gap tích hợp.

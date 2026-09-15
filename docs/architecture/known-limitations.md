# Giới hạn và sai lệch kiến trúc hiện tại

> Snapshot đối chiếu ngày 2026-09-14. Đây là register để tránh mô tả behavior chưa hoàn thiện như guarantee; không phải backlog ưu tiên hay cam kết SLA.

## Database connector pilot boundary

MySQL, MongoDB và DuckDB database connector không phải capability production/pilot. Guard backend trả `database_connectors_disabled` trước mọi resolve host, open file, decrypt credential, probe hay materialize; UI/OpenAPI không quảng bá chúng. DuckDB compute trên canonical CSV/Parquet/JSON vẫn là capability được hỗ trợ.

Connection legacy chỉ giữ metadata redacted để Owner xóa. Dataset đã ingest giữ canonical artifact và không được refresh từ nguồn database. Việc tái mở connector là security design mới cần egress allowlist, sandbox filesystem, TLS/resource policy và regression test; không phải feature flag.

## Mức độ đọc

- **Blocking:** làm local/CI/build/deploy không chạy theo layout hiện tại.
- **Behavior gap:** code chạy nhưng semantics chưa khớp thiết kế mong muốn.
- **Operational gap:** có primitive nhưng thiếu validation/scheduler/evidence production.


## Report submit bỏ qua review — behavior gap

`POST /api/v1/reports/{report_id}/submit` gọi `ReportService.submit_report`, nhưng service hiện publish trực tiếp. Repository vẫn có submit/review primitive và API vẫn có `/review`, song public path chưa tạo chuỗi submit → reviewer approve → publish.

Workspace chỉ có role `analyst`; role này đồng thời có `report.submit`, `report.review` và `report.publish`. Flag `report_separation_of_duties` được lưu nhưng lifecycle chưa enforce. Không mô tả report workflow hiện tại là separation of duties.

## Report list/get không chỉ trả published — behavior gap

Handler tên `list_published_reports` và `get_published_report` gọi repository với `published_only=False`. List loại latest version `rejected`, trong khi get/export-source không dùng filter tương đương. UI hoặc caller có permission có thể thấy draft/in-review; direct lookup có thể thấy report rejected.

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

## Những điều chưa được coi là guarantee

- benchmark synthetic/offline không phải SLA production;
- job delivery là at-least-once, không phải exactly-once;
- Preview approximate không phải Official evidence;
- frontend route guard không phải authorization boundary;
- LangSmith projection không phải source of truth cho audit/evidence;
- compatibility `create_all`/runtime migration không phải production schema strategy;
- report submit hiện tại không chứng minh reviewer độc lập;
- cross-dataset drift không chứng minh hai nguồn comparable;

## Điều kiện đóng các gap

| Gap | Bằng chứng tối thiểu để đóng |
| --- | --- |
| Report lifecycle | route/service/repository thống nhất state transition, capability/SoD test và UI contract |
| Drift comparability | same-dataset invariant hoặc explicit cross-dataset mode có metadata/warning/test |
| Context approval | một governance policy thống nhất cho promote và generic execution |
| HITL policy | typed allow-list + startup validation + negative tests cho PII/key |
| Chat release | staging authenticated evaluation đúng SHA + latency/grounding/privacy evidence |
| Retention | scheduler, metric/alert, dry-run/audit và recovery policy |
| Config | effective-config test cho local/container/CI và secret boundary review |

## Checklist khi cập nhật register

1. trỏ tới code/test cụ thể, không ghi theo cảm nhận;
2. tách behavior đang có khỏi behavior mong muốn;
3. không xóa gap chỉ vì unit test xanh nếu vấn đề là integration/production;
4. cập nhật trang feature/operations liên quan cùng thay đổi;
5. ghi ngày đối chiếu và commit/image khi có release evidence.

Đọc [cấu trúc codebase](./codebase-structure.md), [deployment](../operations/deployment.md) và [evaluation](../development/evaluation.md) để xử lý các gap tích hợp.

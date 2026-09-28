# Artifacts và evidence

**Status: Implemented.** Artifact là output có kiểu của một run/task: query/result, calculation/comparison, data/branch/insight pack, visual evidence, report draft/review và final report. Mỗi artifact có `content_hash`, `input_refs`, `snapshot_refs`, `source_refs`, scope, ngày và semantic version. Bảng lineage nối artifact với input, snapshot và import nguồn; validation record cho biết artifact đã qua kiểm tra nào.

Stage lưu artifact/checkpoint theo key ổn định để retry có thể nạp lại kết quả hợp lệ. Evidence ref chỉ tới `artifact_id`, key và path cụ thể trong payload; claim/report không được dẫn tới giá trị ngoài nguồn đã validate. `GET /runs/{id}/artifacts` trả artifact/validation/source theo quyền. Viewer không thấy draft và review; conversational context cũng không thể dùng hai loại nội bộ này dù caller có quyền xem workflow. Public artifact lookup kiểm hash và validation.

Artifact trong PostgreSQL khác file CSV/export trong Supabase Storage. File nguồn và export có path riêng; artifact runtime không phải file upload tùy ý.

Code: `src/backend/packages/contracts/src/artifacts/artifact.ts`, `src/backend/packages/db/src/repositories/artifact-repository.ts`, `src/backend/packages/agents/src/analysis-v1/checkpoint/artifact-store.ts`, `src/backend/packages/domain/src/artifacts/integrity.ts`. Xem [evidence validation](../agents/evidence-validation.md).

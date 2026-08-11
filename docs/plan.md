# Plan

P-170 sẽ được nâng cấp từ Data Profiling Agent thành một workspace Data Analyst theo hướng evidence-first: Analyst đi từ câu hỏi kinh doanh đến context, quality gate, kế hoạch phân tích, phép tính deterministic, insight đã review và report có thể truy vết. Profile run tiếp tục là snapshot kỹ thuật của dữ liệu; analysis session sẽ là đơn vị công việc nghiệp vụ có thể lưu, tiếp tục, tái chạy và kiểm tra. MVP ưu tiên làm thật chắc cho một dataset/version trước khi mở rộng sang cleaning, multi-table, scheduling hoặc research bên ngoài.

## Scope

- In:
  - Giữ nguyên và tái sử dụng workflow hiện có: upload, profiling, PII/candidate key/semantic type, HITL, statistical test, drift, report, Q&A, audit và masking.
  - Bổ sung business intake, semantic context, metric glossary, dataset grain, quality gate, analysis session và hai chế độ Quick Answer/Deep Analysis.
  - Bổ sung phép aggregate, group-by/pivot, period comparison, trend, segmentation, distribution và chart bằng engine deterministic.
  - Bổ sung Planner–Executor có HITL, query/evidence lineage, insight bank, consistency checker, fact-checked report và session history.
  - Triển khai theo migration additive và feature flag để profile/Q&A hiện tại vẫn dùng được trong suốt quá trình chuyển đổi.
  - Giả định MVP phục vụ một Analyst trên một completed profile run; source, profile, context và metric version được pin trong toàn bộ session.
- Out:
  - MVP không cho LLM/client chạy arbitrary SQL, Python hoặc dynamic code; không trả raw rows/raw PII và không tự sửa dữ liệu gốc.
  - Multi-table join, cleaning có materialization, reference validation, database connector, worker phân tán và scheduled monitoring thuộc phase sau.
  - External web research, business knowledge base dùng chung, causal inference, A/B testing và team approval nhiều cấp chưa nằm trong MVP.
  - PostgreSQL production, object storage, RBAC/SSO và hạ tầng scale-out chỉ được chốt sau khi có yêu cầu triển khai thực tế.

## Action items

- [ ] **1. Ổn định baseline và chốt contract trước khi mở rộng (Phase 0)**

  - Ghi nhận baseline hiện tại: backend có 117 test pass; frontend typecheck, lint, build và 2 Vitest test đang pass. Không coi baseline đã xanh hoàn toàn vì Ruff còn lỗi/format drift và Playwright chưa khởi động được web server.
  - Sửa cấu hình Playwright để lệnh webServer truyền đúng hostname/port, sau đó chạy lại hai E2E hiện có trên môi trường sạch.
  - Đồng bộ catalog statistical test giữa frontend và backend:
    - Frontend hiện gửi ttest_ind trong khi backend đăng ký t_test.
    - Review UI phải yêu cầu đúng số cột cho Pearson, Chi-square và các test hai biến thay vì gửi một cột.
    - Sinh hoặc chia sẻ một test catalog từ backend/OpenAPI để tránh hard-code hai nơi.
  - Quyết định với ADF: thêm statsmodels vào requirements và test dependency, hoặc gỡ ADF khỏi allowlist cho đến khi được hỗ trợ thật.
  - Sửa các lệch persistence đang có:
    - cardinality_margin_of_error được compute nhưng chưa được lưu vào column_stats.
    - Sample row_count hiện là số dòng mẫu; cần tách source_row_count, sampled_row_count và sampling_ratio để UI/report không hiểu nhầm.
    - Drift API phải định nghĩa rõ điều kiện tương thích; không để UI nói “cùng dataset” trong khi backend chấp nhận hai source tùy ý.
  - Đưa Ruff check và Ruff format về trạng thái xanh, không trộn việc format hàng loạt với feature DA trong cùng thay đổi.
  - Bổ sung lệnh quality cross-platform vào Makefile hoặc script riêng để chạy pytest, Ruff, typecheck, lint, Vitest, Playwright và production build.
  - Thiết lập CI với Python 3.11, Node 20 và pnpm 9; lưu JUnit, coverage và Playwright artifacts khi thất bại.
  - **Tiêu chí hoàn tất:** mọi gate hiện có chạy được bằng một lệnh, frontend/backend dùng cùng contract test catalog, profile/Q&A/HITL/test/drift không có regression và team có baseline correctness trước khi thêm schema mới.

- [ ] **2. Chốt user journey và lifecycle thuận tiện nhất cho Data Analyst (Phase 0–1)**

  - Dùng flow mục tiêu thống nhất:

    > Dataset/Profile → Start analysis → Business intake → Context approval → Quality gate → Plan approval → Deterministic execution → Evidence/consistency check → Insight review → Report → Reuse/monitor

  - Tạo hai chế độ rõ ràng:
    - **Quick Answer:** dùng context/metric đã được duyệt, quality gate không có blocker và tối đa một số ít phép tính bounded; trả kết quả nhanh cùng evidence.
    - **Deep Analysis:** bắt buộc có intent, context, quality gate và plan review; cho phép nhiều bước/hypothesis nhưng có iteration, time và cost budget.
  - Định nghĩa lifecycle analysis session:

    > draft → needs_context → quality_review → quality_blocked | plan_review → running → insight_review → reporting → completed

    Với các trạng thái kết thúc phụ: failed và cancelled.
  - User story bắt buộc của MVP:
    - Bắt đầu analysis từ một profile đã hoàn tất mà không phải upload/profile lại.
    - Lưu goal, decision, audience, metric, time scope, population, baseline và output mong muốn.
    - Xem gợi ý grain, key, dimensions, measures, time column và chỉnh sửa trước khi duyệt.
    - Biết dữ liệu có đủ an toàn để trả lời câu hỏi hay phải dừng/acknowledge limitation.
    - Xem, sửa, reorder và duyệt plan trước khi Agent chạy Deep Analysis.
    - Mở mỗi claim/chart/table để xem dataset version, metric, filter, period, sample, query spec, uncertainty và limitation.
    - Accept, edit hoặc reject insight trước khi đưa vào report.
    - Mở lại, clone hoặc rerun session trên cùng version; khi đổi version phải tạo execution mới.
  - Quy tắc chuyển từ Chat:
    - Câu hỏi đã có evidence dùng QA hiện tại.
    - Câu hỏi cần aggregate mới nhưng context rõ có thể chạy Quick Answer.
    - Câu hỏi “vì sao”, cần nhiều phép phân rã hoặc giả thuyết phải đề nghị tạo Deep Analysis session; không âm thầm mở rộng tool budget.
  - **Tiêu chí hoàn tất:** product flow, state transition, quyền edit/approve, trạng thái block/resume và điều kiện Quick/Deep được mô tả bằng acceptance test trước khi code API/UI.

- [ ] **3. Xây nền dataset version, analysis persistence và migration có version (Phase 0–1)**

  - Thay runtime create_all + ALTER TABLE rời rạc bằng migration versioned, ưu tiên Alembic:
    - Test fresh database.
    - Test nâng cấp từ snapshot SQLite hiện tại.
    - Backfill idempotent và validate row count/checksum.
    - Có backup/restore rehearsal; downgrade chỉ dùng khi thực sự an toàn.
  - Bổ sung dataset lineage:
    - dataset_versions lưu source fingerprint/content hash, file size, schema fingerprint, source row count, created_at và parent_version_id.
    - profile_runs liên kết dataset_version_id; các run cũ được backfill theo source hiện có.
    - Uploaded/raw source là immutable; cùng tên file không được làm mất identity của version cũ.
  - Thêm nhóm bảng cốt lõi:
    - analysis_sessions: mode, status, goal, decision, audience, output, time scope, population, baseline, creator và graph thread.
    - analysis_sources: session, dataset version, profile run, alias và role; MVP enforce đúng một source.
    - semantic_context_versions: row grain, entity, keys, time column/timezone, dimensions, measures, ignored columns, limitations và approval.
    - metric_definitions: name, display name, formula spec, aggregation, unit/currency, default filters, time column, version và approval.
    - quality_gate_runs và quality_issues: rule, dimension, severity, evidence, status, reviewer và resolution note.
    - analysis_plans và analysis_plan_steps: version, dependency/order, tool, typed inputs, expected output, status và error.
    - query_executions/evidence_records: canonical query spec, tool version, pinned versions, filters, time/grain, sample/seed, duration, result hash, bounded artifact và limitations.
    - insights và insight_evidence: claim, metric/value, baseline, filters, period, sample size, uncertainty, limitations, confidence, review status và evidence links.
    - analysis_reports: version, content/outline, status, fact-check result, unsupported claims và finalized metadata.
  - Không cần chuẩn hóa quá mức ở MVP: dùng cột quan trọng để index/filter, còn formula spec, query spec, uncertainty và chart spec có thể lưu JSON đã validate.
  - Tách repository theo domain thay vì tiếp tục làm lớn backend/src/services/repository.py, ví dụ analysis_repository.py, evidence_repository.py và migration package; giữ transaction boundary tại workflow service.
  - Thêm foreign key/index/cascade cho session status, source/run, plan step, query execution và insight review. Xóa dataset phải xử lý rõ session/artifact liên quan; mặc định ưu tiên soft-delete hoặc chặn khi còn report cần audit.
  - Dùng optimistic version hoặc updated_at precondition cho context, metric và plan để tránh hai tab ghi đè lẫn nhau.
  - **Tiêu chí hoàn tất:** mọi execution pin được dataset/profile/context/metric version; thay đổi context không sửa provenance cũ; fresh/upgrade/rollback/backup-restore test đều pass; tắt feature flag vẫn dùng profile workflow cũ.

- [ ] **4. Mở rộng semantic context, profiling metrics và quality gate theo mục đích phân tích (Phase 1)**

  - Tạo service semantic_context.py để kết hợp deterministic inference với Analyst approval:
    - Dataset description và row grain.
    - Entity/candidate key dùng cho distinct count.
    - Column role: key, dimension, measure, datetime, text, ignored.
    - Default aggregation, unit/currency, timezone và business limitations.
  - Metric glossary phải dùng DSL/AST đã validate, không lưu raw SQL:
    - Hỗ trợ count, count distinct, sum, mean, weighted mean, median, ratio và derived arithmetic allowlist.
    - Metric quan trọng phải có owner/approved_by, version, unit, entity grain, default filters và denominator policy.
    - Khi đổi công thức gross/net hoặc filter trạng thái, tạo version mới và invalidate plan chưa chạy.
  - Mở rộng backend/src/services/compute.py và persistence theo mức ưu tiên:
    - Dataset: source/sample row count, sampling ratio, file size, time coverage, empty rows, fully-null, constant/near-constant, duplicate, parse/encoding error và type confidence.
    - Numeric: variance, IQR, p01/p05/p25/p50/p75/p95/p99, skewness, kurtosis, zero/negative rate, outlier rate và uncertainty khi sample.
    - Categorical: empty/unknown/rare rate, entropy, top-1 concentration và normalization candidates; không lưu Top-k PII.
    - Datetime: min/max, actual frequency, missing periods, duplicate/future timestamps, freshness, partial-period flag và timezone ambiguity.
    - Text: empty rate, length min/median/p95/max, word count, normalization/pattern và PII risk.
    - Relationship ở Phase 1 chỉ làm phần cần cho gate/invariant; Spearman, Kendall, mutual information và conditional missingness có thể hoàn tất ở Phase 2.
  - Tạo quality_gate.py với sáu dimension nhưng không gộp thành một score:
    - Completeness, uniqueness, consistency, timeliness và validity được đo bằng rule/evidence.
    - Accuracy trả not_evaluated nếu chưa có trusted reference; không suy ra từ một file.
    - Severity là critical, warning hoặc info; threshold có default trong config nhưng session/business intent có thể override có kiểm soát.
  - Block các trường hợp critical:
    - Profile chưa completed hoặc proposal PII/context quan trọng chưa review.
    - Grain/key/metric/timezone không đủ rõ cho phép tính được yêu cầu.
    - Metric/time column thiếu coverage; source rỗng/parse lỗi; exact analysis chỉ có sample mà Analyst chưa chấp thuận.
    - Join multiplication sẽ được bổ sung khi sang multi-table.
  - Warning yêu cầu Analyst acknowledge kèm lý do: partial period, missing/duplicate/outlier cao, sample nhỏ, timezone mơ hồ, denominator gần 0 hoặc representativeness chưa biết.
  - Không tự xóa outlier, fill missing hoặc đổi type. Gate chỉ giải thích tác động và đề xuất bước xử lý.
  - **Tiêu chí hoàn tất:** trước mọi phép tính, UI/API trả gate decision, evidence, impacted metric và cách khắc phục; critical fail closed, warning có audit acknowledgement, accuracy không bao giờ bị bịa.

- [ ] **5. Xây deterministic analysis engine, query DSL và evidence ledger (Phase 1)**

  - Tạo backend/src/services/analysis_engine.py dùng DuckDB query pushdown thay vì materialize toàn bộ file thành pandas ở mỗi bước. Lý do: full scan hiện dùng DuckDB .df() và cache DataFrame chỉ giữ tối đa tám run, không phù hợp planner nhiều vòng.
  - Định nghĩa typed QuerySpec chỉ gồm:
    - Source alias do server map tới pinned dataset version.
    - Approved metric hoặc aggregate allowlist.
    - Dimensions/group-by, typed filters, time range/grain, comparison, order và limit.
    - Không nhận raw SQL, file path, profile/session ID tùy ý hoặc executable expression từ LLM/client.
  - Compiler phải quote identifier, parameterize value và validate column role/type/operator. Fail closed khi unknown column, unsupported operator, stale metric/context version hoặc scope không khớp.
  - Tool MVP:
    - get_analysis_context và get_quality_summary.
    - aggregate và pivot/cross-tab.
    - compare_periods.
    - trend_analysis và rolling average.
    - segment_analysis/contribution.
    - distribution_summary.
    - correlation cùng statistical test/drift hiện có.
    - build_chart_spec từ aggregate data.
  - Chuẩn hóa kết quả theo envelope hiện có: data, evidence, limitations, is_approximate, error_code; bổ sung query_execution_id và artifact_id.
  - Mỗi query execution lưu canonical spec, compiled/executed query nội bộ, source hash, profile/context/metric version, filter/timezone/baseline, sample/seed, row count, duration, result hash, uncertainty và limitation.
  - Bảo vệ tài nguyên:
    - Timeout, max scanned bytes/rows, max groups, max output rows/chars, pagination và cancellation.
    - Cache theo dataset hash + context/metric version + canonical QuerySpec; cache hit vẫn trả evidence ID gốc hoặc một execution reference rõ ràng.
    - Cảnh báo denominator 0/gần 0, tiny groups, extreme percentage change và partial period.
  - Bảo vệ privacy:
    - Không có tool trả raw rows.
    - Cấm group-by/top-k trên PII trực tiếp; quasi-ID hoặc nhóm nhỏ phải suppress theo ngưỡng cấu hình.
    - Session/source scope được server inject giống active profile_run hiện tại; LLM không chọn ID.
  - Việc persist artifact/insight do workflow service thực hiện sau validation; không bind generic write tool hoặc register_insight trực tiếp cho LLM.
  - **Tiêu chí hoàn tất:** cùng version + seed + QuerySpec cho cùng result hash; golden aggregate/filter/time/baseline đúng 100%; query không hợp lệ, vượt budget, PII hoặc cross-session đều bị chặn và audit.

- [ ] **6. Thêm API/job lifecycle và Analysis Graph Planner–Executor (Phase 1–2)**

  - Tách backend/src/api/analysis_routes.py, backend/src/models/analysis_schemas.py và graph riêng thay vì nhồi thêm vào routes.py, schemas.py và ProfilingState.
  - API resource đề xuất:
    - POST/GET/PATCH /api/v1/analysis-sessions.
    - POST /analysis-sessions/{id}/context-versions và endpoint approve.
    - POST /analysis-sessions/{id}/quality-gate và endpoint acknowledge/resolve.
    - POST /analysis-sessions/{id}/plans; PATCH plan/steps; endpoint approve.
    - POST /analysis-sessions/{id}/executions; GET execution/status; POST cancel/retry.
    - GET /analysis-sessions/{id}/events bằng SSE.
    - GET artifacts/insights; PATCH insight review.
    - POST reports; GET report/export.
  - Mutation tạo session, approve, execute, retry và finalize phải có idempotency key; execution kiểm tra expected context/metric/plan version để tránh chạy plan cũ.
  - Phase 1 có thể chạy job in-process với durable status/checkpoint và cancellation cooperative, nhưng không giữ HTTP request đồng bộ đến cuối. Khi có concurrent workload/scheduling mới chuyển sang worker queue.
  - Tạo AnalysisState và thread ID dạng analysis:{session_id}; graph đề xuất:

    > load_session → clarify_intent → build/review_context → quality_gate → plan → plan_review_interrupt → execute_steps → consistency_check → build_insights → insight_review_interrupt → compose_report → fact_check → finalize

  - Planner chỉ xuất structured plan theo Pydantic schema; Orchestrator validate columns, metrics, dependencies, expected artifact, cost và quality gate trước khi cho Executor chạy.
  - Executor chỉ gọi allowlisted deterministic tools; có max steps, max hypotheses, max retries, time/cost/token budget và stop rule khi evidence không đủ.
  - Consistency checker so canonical signatures để phát hiện:
    - COUNT(*) bị trộn với COUNT(DISTINCT entity key).
    - Gross/net metric, unit/currency hoặc default filter không nhất quán.
    - Timezone, period, partial period hoặc baseline khác nhau.
    - Grain/source/context/metric version bị trộn.
    - Join cardinality/multiplication khi Phase 3 được bật.
  - Quick Answer không chạy hypothesis loop; Deep Analysis bắt buộc plan approval và insight review.
  - Không có LLM key thì manual analysis builder và deterministic tools vẫn dùng được; chỉ planner/narrative báo thiếu capability thay vì chặn toàn bộ session.
  - **Tiêu chí hoàn tất:** graph resume đúng sau restart với checkpointer bền vững, double-submit không chạy hai lần, cancel/retry có trạng thái rõ, report không được finalize khi còn inconsistency hoặc numeric claim thiếu evidence.

- [ ] **7. Xây DA Workspace trên frontend theo một luồng liên tục (Phase 1–2)**

  - Thêm CTA **Start analysis** tại frontend/src/app/profiles/[runId]/page.tsx; profile pending review dẫn về Review trước.
  - Thêm route:
    - /analyses: danh sách session, filter status/mode/dataset, resume/clone.
    - /analyses/new: wizard chọn source → goal → context/metric → quality.
    - /analyses/[sessionId]: workspace chính.
  - Bổ sung **Analyses** vào AppShell; giữ Datasets, Drift và Chat làm lối tắt, không tạo các workflow rời rạc trùng nhau.
  - Workspace chính gồm:
    - Header: session status/mode, dataset + profile version, exact/sample và last saved.
    - Stepper: Intent → Context → Quality → Plan → Explore → Insights → Report.
    - Panel intent/context: inline edit, metric glossary, grain/key/timezone và known limitations.
    - Quality panel: critical/warning/info, impacted metric, evidence, acknowledge/resolution.
    - Plan panel: edit/reorder/approve, estimated scope, dependency, step status, cancel/retry.
    - Explore panel: manual aggregate/pivot builder, filter/time controls và suggested questions; đây là fallback hữu ích khi không có LLM.
    - Result cards/table/chart có exact/approximate, sample size, baseline, unit và warning ngay cạnh số liệu.
    - Evidence drawer: canonical query, filter, period/timezone, versions, execution ID, uncertainty, limitations và audit timestamp.
    - Insight bank: needs_review, accepted, edited, rejected; chỉ accepted insight đi vào report.
    - Report editor/preview: claim–evidence links và fact-check status.
  - Tạo frontend/src/lib/analysis-types.ts, analysis-api.ts và components/analysis thay vì làm lớn types.ts/api.ts/page.tsx hiện tại.
  - Chart phải dùng declarative ChartSpec và aggregate artifact, hỗ trợ tối thiểu bar, line, histogram, box plot, scatter và heatmap; giới hạn category/point, không render executable code hoặc raw PII.
  - UX convenience bắt buộc:
    - Autosave draft có feedback và conflict handling.
    - Preset câu hỏi/metric/time comparison nhưng luôn hiển thị định nghĩa.
    - Loading, empty, stale, partial failure, cancel/retry và offline/backend error state.
    - Keyboard navigation, table semantics, color contrast, text alternative cho chart và responsive layout.
  - **Tiêu chí hoàn tất:** E2E thật đi được từ completed profile đến final report trong một workspace, có cả quality-block path, metric edit, plan review, evidence drill-down, cancel/resume và export.

- [ ] **8. Hoàn thiện insight bank, visualization và evidence-linked report (Phase 2)**

  - Mỗi insight lưu tối thiểu claim, metric, value, comparison/baseline, filters, time window, source/context/metric version, query/evidence IDs, sample size, uncertainty, limitations và review status.
  - LLM chỉ viết narrative từ accepted insights; không tự thêm số. Edit claim phải giữ link evidence hoặc chuyển về needs_review nếu thay đổi ý nghĩa.
  - Report pipeline:
    - Tạo outline.
    - Gán evidence/insight vào từng section.
    - Viết section.
    - Parse/check numeric claims, unit, filter, time window và baseline.
    - Chặn unsupported claim; trả lại section cần sửa.
    - Analyst review/finalize và tạo immutable report version.
  - Report MVP có đủ: executive summary, business question, scope/metric definition, quality warning, methodology, findings, chart/table, limitations, recommended next action và evidence appendix.
  - Chart service trả ChartSpec + bounded aggregate data; LLM được chọn chart type/titles từ allowlist, compute engine quyết định data và validation.
  - Export đầu tiên nên gồm Markdown report, JSON evidence bundle và CSV cho aggregate table. PDF/notebook/SQL export để sau khi report/evidence contract ổn định; tuyệt đối không export raw source qua analysis endpoint.
  - Cho phép clone session/template sang profile version mới; quality gate và execution phải chạy lại, không copy kết luận như evidence mới.
  - **Tiêu chí hoàn tất:** 100% numeric claim trong final report có evidence ID và khớp deterministic result trong tolerance công bố; unsupported numeric claim bằng 0; mọi chart truy được về artifact/query và không lộ PII.

- [ ] **9. Xây test pyramid, benchmark DA, observability và security gate (xuyên suốt)**

  - Unit test mới:
    - Metric DSL/parser/compiler, filter/operator và identifier safety.
    - Aggregate, weighted average, percentage/share/rank change, period comparison, rolling trend và segment decomposition.
    - Quality rule/severity, partial period, zero denominator, timezone và sample uncertainty.
    - Query consistency, claim–evidence fact check, chart spec và privacy suppression.
    - Statistical test mở rộng phải chuẩn hóa effect size, confidence interval, assumptions và missing-data handling.
  - Property/metamorphic test:
    - Shuffle row không đổi full-scan aggregate.
    - Cùng sample seed cho kết quả tái lập.
    - Thêm duplicate key hoặc many-to-many join phải làm gate/consistency checker cảnh báo.
    - Metric equivalent/canonical QuerySpec cho cùng result hash.
  - API/integration test:
    - Session lifecycle, approval/version conflict, idempotency, cancel/retry, deletion/retention.
    - Fresh migration, upgrade từ DB cũ, restart/resume và concurrent startup.
    - Cross-session/run isolation, result bound, timeout, PII masking và audit.
    - CSV/TSV/JSON/Parquet, malformed encoding/schema, empty/all-null, wide/large và source bị mất/đổi.
  - Agent graph test:
    - Quick/Deep routing, invalid plan, quality block, plan/insight interrupt, loop budget, provider outage, resume và unsupported claim.
  - Frontend test:
    - Component/unit cho intake, metric editor, gate, plan, progress, evidence, insight và report.
    - Playwright real-backend flow, không chỉ mock: start analysis, block/acknowledge, edit metric, approve plan, evidence drill-down, cancel/resume, finalize/export.
    - Accessibility scan và keyboard flow cho wizard/workspace.
  - Golden benchmark gồm các dataset/câu hỏi có deterministic oracle:
    - Order và order-item để bắt sai grain/count distinct.
    - Gross/net revenue và completed/refund filter.
    - Missing/partial period, missing dates, timezone/DST, zero denominator.
    - Outlier, small group, PII/quasi-ID, sample/full và category/numeric drift.
    - Phase 3 thêm duplicate join, unmatched reference và join multiplication.
  - Release quality target:
    - 100% critical golden cases và tối thiểu 95% benchmark tổng.
    - Numeric/filter/time/baseline đúng trong tolerance đã công bố.
    - 100% numeric claim có evidence; 0 unsupported numeric claim trong final report.
    - 0 raw PII/cross-session leak; mọi tool bounded, scoped và audited.
    - Same version + seed tái lập.
    - Đo coverage baseline rồi enforce không giảm; hướng tới backend tối thiểu 85%, frontend 75% và 100% nhánh critical của query/security/fact-check.
  - Observability:
    - Backend sinh/propagate X-Correlation-ID vì frontend đã đọc header này.
    - Structured logs/traces gắn session, execution, source version, graph node, tool, query, model, duration và error; redact question/path/raw value theo policy.
    - Metrics cho request/error/p50-p95, scanned rows/bytes, tool failure, stuck workflow, checkpoint fallback, token/cost, evidence coverage, unsupported claims và review accept/edit/reject.
    - Tách audit nghiệp vụ khỏi telemetry; thêm readiness check DB, checkpointer, storage, index và migration. Production không silent fallback MemorySaver.
  - **Tiêu chí hoàn tất:** CI, benchmark, security, migration và real E2E đều xanh; có dashboard/runbook cho lỗi workflow, privacy, migration và provider outage trước pilot.

- [ ] **10. Rollout theo phase và chỉ mở rộng khi đạt exit gate**

  - **Phase 1 — DA Copilot một dataset:** analysis session, intake, context/metric approval, quality gate, manual/Quick aggregate, period compare, trend, segmentation, safe chart, evidence-linked answer và session resume.
  - **Phase 2 — Deep Analysis:** Planner–Executor, bounded hypothesis loop, insight bank, consistency checker, effect size/CI, fact-checked report và export.
  - **Phase 3 — Data Preparation và Multi-table:**
    - Cleaning suggestion trước; cleaning recipe chỉ dùng operation allowlist, preview before/after và tạo derived dataset version.
    - Raw version không đổi; rollback là chọn lại parent version, không undo phá dữ liệu.
    - Join contract lưu key/cardinality; preview unmatched rate, duplicate key và multiplication factor; unexpected many-to-many phải block.
    - Reference validation mới được phép đánh giá Accuracy.
    - Sau khi job lifecycle ổn định mới thêm worker, scheduled profile/drift và alert.
  - **Phase 4 — Research/enterprise tùy nhu cầu:** connectors, business knowledge base, shared metric layer, external research opt-in, experiment/causal analysis, auth/RBAC, team review và collaboration.
  - Rollout kỹ thuật:
    - Feature flag riêng cho analysis session, planner, insights, cleaning và monitoring.
    - Internal golden run → Analyst pilot → canary có quan sát → mở rộng; shadow execution trước khi Agent tự đề xuất deep plan.
    - Migration theo expand → backfill → dual-read/write nếu cần → validate → switch → contract ở release sau.
    - Rollback bằng feature flag và code backward-compatible; giữ backup/restore đã rehearsal.
  - Đo product funnel: Start analysis → context approved → plan approved → insight accepted → report finalized; theo dõi abandonment, critical gate, tool failure, rerun, insight acceptance và thời gian hoàn thành.
  - Chỉ mở phase tiếp theo khi phase hiện tại đạt correctness, evidence, privacy, reproducibility, migration và pilot acceptance gate; không dùng độ “tự nhiên” của narrative làm tiêu chí chính.
  - **Tiêu chí hoàn tất toàn dự án:** một Analyst có thể hoàn thành business intake → hiểu dữ liệu → kiểm tra chất lượng → lập/duyệt plan → tính toán → kiểm tra evidence → duyệt insight → xuất report trong một session có thể resume và tái lập, mà không phải tin vào con số do LLM tự sinh.

## Open questions

- MVP ưu tiên domain/câu hỏi nào và quy mô file thực tế là bao nhiêu? Khuyến nghị chốt 3–5 golden business questions và ba band dữ liệu nhỏ/vừa/lớn trước để thiết kế metric template, threshold và performance budget.
- Môi trường mục tiêu là local một Analyst hay multi-user production? Khuyến nghị giữ SQLite/in-process cho local MVP, nhưng nếu cần multi-user/scheduling thì phải chốt PostgreSQL, durable worker, auth và object storage ngay từ Phase 0.
- Định dạng bàn giao đầu tiên cần gì? Khuyến nghị Markdown report + JSON evidence + CSV aggregate ở MVP; PDF/notebook/dashboard và team approval chỉ thêm sau khi report/evidence contract ổn định.

# Plan

Nâng VDaAgent từ fixed profiling workflow + bounded Q&A hiện tại thành một agent runtime có thể truy nguyên, kiểm chứng và phục hồi, nhưng vẫn giữ invariant: compute deterministic tạo số liệu, mọi truy cập được scope theo workspace, và planner không bao giờ sinh hoặc thực thi arbitrary SQL/code. Thứ tự triển khai là **contract/evaluation → trace/evidence → capability registry → verifier → bounded planner/HITL → skills → reliability/memory → rollout**, để mỗi lớp mới đều có test và đường rollback trước khi được bật cho người dùng.

## Scope

- In:
  - Execution trace đầy đủ cho profiling, Q&A và Analysis: step, tool/model call, evidence, lỗi/retry, version, token/cost và approval.
  - Capability registry có manifest, typed input/output, permission/risk/side-effect/context/runtime/version validation.
  - Skill ở tầng workflow với input/output/acceptance criteria; không coi skill là một prompt.
  - Deterministic verifier/evidence checker và no-tool answer guard.
  - Planner có schema, dependency DAG, budget, timeout, approval, retry/resume từng step và không có entry point cho SQL/code tự do.
  - Bounded ReAct cho Q&A định lượng/deep analysis; profiling tiếp tục là workflow cố định.
  - Approval policy/HITL tổng quát, UI plan/trace/approval, memory có chủ đích, evaluation framework và production reliability.
  - Migration, feature flag, compatibility API, CI gate, rollout và rollback.
- Out:
  - Join nhiều dataset, notebook, data cleaning recipe, arbitrary SQL, arbitrary Python/JavaScript/shell hoặc tool được tạo động bởi model.
  - Expose chain-of-thought, raw prompt, raw row, secret hoặc PII chưa mask trong trace/UI/log/eval artifact.
  - Long-term personal memory mặc định hoặc lưu toàn bộ chat phía server.
  - Thay deterministic compute/statistical engine bằng LLM.

## Action items

[ ] 1. Đóng băng invariant, contract và dependency graph trước khi thay runtime.

  - Ghi nhận baseline hiện tại làm compatibility contract:
    - Profiling graph cố định nằm ở `backend/src/agents/graph.py::build_profiling_graph` và đã có PostgreSQL checkpoint/HITL resume.
    - Q&A định lượng ở `backend/src/agents/nodes/qa_nodes.py::qa_structured_node` đã có giới hạn vòng model/tool, nhưng model vẫn có thể trả lời khi chưa gọi tool.
    - Tool hiện là read-only list trong `backend/src/agents/tools/registry.py`; `ToolEnvelope` đã có nhưng dispatcher chưa validate output bằng Pydantic, chưa validate permission/workspace/version/runtime.
    - `QuerySpec` và `AnalysisEngine` đã là bounded aggregate boundary; tiếp tục dùng chúng làm primitive phân tích duy nhất thay vì thêm raw-query API.
    - `query_executions` đã có canonical query, result hash, approximation, limitation và duration; tái sử dụng làm một nguồn evidence, không thay thế execution trace.
    - `deep` analysis hiện chỉ chuyển sang status `plan_review`; chưa có plan record, validator, approval hoặc executor.
  - Thêm ADR ngắn trong `docs/` chốt các quyết định:
    1. domain database là nguồn sự thật cho run/plan/step/evidence; LangGraph checkpoint chỉ là orchestration state;
    2. profiling là fixed workflow; planner chỉ áp dụng cho Q&A định lượng phức tạp và deep analysis;
    3. mọi thao tác dữ liệu đi qua registered capability hoặc `AnalysisEngine`;
    4. trace lưu decision code/rationale ngắn đã sanitize, không lưu chain-of-thought;
    5. deterministic verifier là release gate, LLM verifier không nằm trong MVP;
    6. với runtime v2, `agent_runs`/step attempts là state machine authoritative; `profile_runs`/`analysis_sessions` là domain projection và LangGraph checkpoint không phải nguồn status. State transition + trace/outbox được commit atomically, có reconciliation job khi projection lệch.
  - Thêm feature flags trong `backend/src/config.py`, `config.yaml` và `.env.example`:
    - `AGENT_TRACE_MODE=off|shadow|required`
    - `AGENT_VERIFIER_MODE=off|shadow|enforce`
    - `AGENT_PLANNER_ENABLED=false`
    - `AGENT_JOBS_ENABLED=false`
    - `AGENT_WORKSPACE_MEMORY_ENABLED=false`
    - `AGENT_PERSONAL_MEMORY_ENABLED=false`
  - Tạo skeleton eval và **chạy/lưu approved pre-refactor baseline + golden outputs ngay trong phase này**; pin commit SHA, fixture hash và current prompt/model/tool manifest. Không chờ planner hoặc refactor xong mới tạo baseline.
  - Sửa prerequisite migration trước khi thêm bảng agent: test phải chứng minh migration chạy được trên cả database trống và database legacy. Runtime `metadata.create_all()`/`ALTER TABLE` ở non-production không được che khuất migration thiếu trong production; rolling rollout tách thành các release gate `expand → deploy app/worker dual-compatible → backfill idempotent + validate ownership/orphan → drain N-1 → enforce`. Không áp blanket `workspace_id NOT NULL`: external knowledge/global audit phải tách table hoặc có nullable/check-policy rõ, còn tenant documents mới enforce ownership.
  - Sinh backend dependency lock có hash (giữ `requirements.txt` làm input nếu cần), pin image/container digest trong CI/deploy và ghi lock/runtime digest vào version snapshot; dependency `>=` hiện tại không đủ để tái lập một agent run.
  - Dependency triển khai bắt buộc:

    ```text
    P0 contract + migration tests + eval skeleton
       ├── P1 trace/evidence/versioning
       └── P2 capability registry/context
               P1 + P2 ──> P3 deterministic verifier
    P0 + P1 + P2 + P3 ──> P4 durable executor/cost + bounded planner
                     P4 ──> P5 approval policy + UI
                P2 + P4 ──> P6 skill workflows
         P1 + P4 + P5 ──> P7 reliability hardening/DLQ/circuit
                P3 + P5 ──> P8 governed memory
                    all ──> P9 staged rollout
    ```

  - Acceptance criteria:
    - Các invariant trên có test regression và được dẫn chiếu từ `README.md`/`docs/summary.md`.
    - Không phase nào có thể bật planner nếu trace, capability validation, verifier và deterministic eval gate chưa pass.
    - Fresh/legacy migration test chạy mà không dựa vào `create_all()`; pre-refactor baseline đã được duyệt trước commit refactor đầu tiên.

[ ] 2. Xây execution trace, canonical evidence và version snapshot làm nền runtime.

  - Tạo package `backend/src/agents/runtime/`:
    - `schemas.py`: `AgentRun`, `PlanRecord`, `StepRecord`, `StepAttempt`, `ModelInvocation`, `ToolInvocation`, `TraceEvent`, `UsageBudget`.
    - `context.py`: `ExecutionContext` chứa `agent_run_id`, `workspace_id`, actor, effective permissions, resource bindings, correlation ID, deadline, cancellation token và budget ledger.
    - `trace.py`: append/query event, redaction, stable hash và public trace projection.
    - `versioning.py`: model/prompt/capability/runtime snapshot.
    - `budgets.py`: reserve/commit/release token/cost/runtime/tool-call budget.
  - Public trace contract phải trả lời trực tiếp, không cần suy luận từ log rời rạc:
    - Agent đã làm những bước nào và trạng thái/thời lượng của từng bước?
    - Tool nào được gọi, với lý do gì, input đã sanitize nào và kết quả nào?
    - Số liệu/evidence nào được dùng cho từng claim trong câu trả lời?
    - Bước nào lỗi, timeout, bị retry hoặc fallback; attempt nào cuối cùng thành công?
    - Model, prompt version, capability/tool version và runtime/policy version nào đã tạo kết quả?
  - Thêm additive migration, dự kiến `backend/migrations/versions/20260813_0004_agent_runtime.py`, với các bảng tenant-scoped:

    | Bảng | Mục đích tối thiểu |
    | --- | --- |
    | `agent_runs` | Loại run, workspace/actor/resource, status, correlation/idempotency, policy/runtime version, budget/usage, start/end/error. |
    | `agent_plans` | Immutable plan version, schema version, plan hash, validation status và superseded version. |
    | `agent_steps` | Step definition, capability/skill version, dependency IDs, reason code/summary, approval rule, current status. |
    | `agent_step_attempts` | Attempt number, start/end, input/output hash, retry classification, error code và checkpoint. |
    | `model_invocations` | Provider/model/parameters, prompt ID/version/hash, request/response hash, token usage, estimated cost, latency, retry/error. |
    | `tool_invocations` | Tool name/version, sanitized args, reason code, status, timeout, attempt, latency, error và evidence IDs. |
    | `evidence_items` | Canonical source coordinates, exact bounded value, unit, approximation, limitation, source/result hash và producer invocation. |
    | `verification_runs` | Answer/claim hash, verifier version, outcome, violations và recovery decision. |
    | `approval_requests` | Plan/step/version hash, risk, preview, status, approver, decision note, expiry và invalidation reason. |
    | `agent_trace_events` | Append-only ordered state changes/outbox để dựng timeline/SSE; payload đã redact và có schema version. |

  - Mọi bảng phải có `workspace_id` hoặc join bắt buộc tới một parent tenant-scoped; thêm index theo `(workspace_id, created_at)`, unique `(agent_run_id, sequence)` và `(agent_run_id, status)`. Sequence phải duy nhất/tăng đơn điệu và timeline sort deterministic; gap do transaction rollback được phép. Mỗi state transition + trace event/outbox phải commit trong cùng transaction, sau đó projector/reconciler cập nhật read model.
  - Định nghĩa canonical evidence tối thiểu:

    ```json
    {
      "evidence_id": "ev_...",
      "workspace_id": "server-injected",
      "profile_run_id": "run_...",
      "context_version_id": null,
      "execution_id": null,
      "artifact_type": "column_stat",
      "artifact_id": "server-resolved",
      "field_path": "columns.salary.null_pct",
      "value": 3.25,
      "unit": "percent",
      "is_approximate": false,
      "limitations": [],
      "source_hash": "sha256:...",
      "source_version": "etag/provider-generation/content-sha",
      "producer_invocation_id": "tool_..."
    }
    ```

  - Evidence chỉ lưu scalar/aggregate hoặc bounded structured result mà capability cho phép; không lưu raw row, unmasked PII, source path, secret hay arbitrary retrieval chunk. Với payload lớn, lưu artifact reference + content hash và retention policy thay vì nhân bản toàn bộ result.
  - Pin source provenance ngay khi upload/profile bằng content SHA và provider ETag/generation/version. Mỗi resume/reload phải verify immutable source version; mismatch fail closed và không tạo evidence từ bytes mới. `source_hash` không được suy ra chỉ từ mutable `source_ref`.
  - Version hóa prompt bằng `PromptSpec(id, version, template_hash, output_schema_version)` trong `backend/src/agents/prompt_registry.py` (hoặc chủ động migrate `prompts.py` thành package); mỗi model call snapshot provider, model ID, provider deployment/revision hoặc response fingerprint (nếu có), relevant parameters, prompt versions và SDK/dependency/runtime digest. Mutable alias không có revision phải được đánh dấu `model_revision_unpinned`, không được trình bày như reproducible version. Không lưu raw system prompt trong trace API.
  - Model/cost snapshot phải có `pricing_catalog_version`, currency, precision và rate cho input/output/cached/reasoning tokens. Khi provider thiếu usage, record `usage_status=unknown`, reconcile bằng policy bảo thủ và không coi estimated cost là exact.
  - Retrieval là một versioned capability: trace/baseline pin corpus revision, index/build version, embedding/reranker model + version, ranking parameters, metadata filter, query hash và result IDs/scores. Thay corpus/index phải làm manifest thay đổi ngay cả khi prompt/model không đổi.
  - Instrument tất cả trust boundary:
    - wrapper quanh mỗi LangGraph node;
    - wrapper quanh model invocation trong `backend/src/services/llm.py`;
    - dispatcher capability/tool;
    - retrieval call;
    - `AnalysisEngine` execution;
    - approval, cancellation, retry và fallback.
  - Thay audit event rời rạc trong agent node bằng trace writer có `workspace_id`, actor và correlation ID; tiếp tục ghi `audit_events` cho security/business audit nhưng không dùng audit table thay execution trace.
  - Không ghi “lý luận nội bộ”. Trace public chỉ có `reason_code` và câu giải thích ngắn như `metric_required`, `missing_evidence`, `dependency_ready`, `approval_policy`; raw messages/model scratchpad không được persist.
  - Chốt retention/deletion: dataset/guest/workspace cleanup không được tạo FK orphan hoặc xóa nhầm audit. Dùng policy rõ cho cascade vs tombstone, content redaction, legal hold và expiry; trace giữ provenance/hash tối thiểu nhưng xóa bounded value khi retention/consent yêu cầu.
  - Mở API tenant-scoped trong `backend/src/api/agent_routes.py`:
    - `GET /api/v1/agent-runs/{run_id}`
    - `GET /api/v1/agent-runs/{run_id}/trace`
    - `GET /api/v1/agent-runs/{run_id}/evidence`
    - `GET /api/v1/agent-runs/{run_id}/plan`
  - Mở rộng `QAResponse`/Analysis response theo hướng additive với `agent_run_id`, `verification`, `trace_summary`; endpoint hiện tại vẫn hoạt động trong compatibility window.
  - Acceptance criteria:
    - Từ một `agent_run_id` có thể trả lời: đã chạy step nào, tool/model nào và vì sao, evidence nào tạo từng số, lỗi/retry ở attempt nào, và model/prompt/tool/runtime version nào tạo output.
    - Run bị lỗi/cancel vẫn có terminal trace; sequence duy nhất/tăng đơn điệu và read model có thể reconcile từ event/outbox.
    - Trace/API/log không chứa secret, raw row, raw prompt, chain-of-thought hoặc PII value.

[ ] 3. Chuẩn hóa tools thành capability registry, sau đó mới dựng skill registry.

  - Tạo `backend/src/agents/capabilities/` với `schemas.py`, `context.py`, `registry.py`, `dispatcher.py` và domain manifests. Giữ `backend/src/agents/tools/registry.py` làm compatibility adapter trong một release, rồi loại bỏ danh sách tool song song.
  - `CapabilityManifest` bắt buộc có đúng các field nền tảng sau; cho phép thêm `retry_policy`, `idempotency`, `cost_class` và `deprecation` nhưng không được bỏ field bắt buộc:

    ```json
    {
      "name": "get_column_profile",
      "description": "Get a bounded aggregate profile for one column.",
      "input_schema": "GetColumnProfileInput@1",
      "output_schema": "ColumnProfileResult@1",
      "permissions": ["profile.read"],
      "risk_level": "read",
      "side_effects": false,
      "required_context": ["workspace_id", "profile_run_id"],
      "max_runtime": "5s",
      "version": "1.2.0"
    }
    ```

  - `input_schema`/`output_schema` là stable schema ID nhưng registry phải resolve và expose được JSON Schema đầy đủ; manifest snapshot/hash bao gồm nội dung schema, không chỉ tên tham chiếu.
  - Manifest và handler được đăng ký cùng nhau; startup fail nếu trùng `(name, version)`, version không hợp lệ, schema thiếu, permission không có trong catalog, output không phải bounded schema hoặc side-effect/risk không nhất quán.
  - Dispatcher thực hiện theo thứ tự fail-closed:
    1. resolve exact capability version từ plan/run snapshot;
    2. validate typed input với `extra="forbid"`;
    3. inject `CapabilityContext` từ server, không nhận workspace/profile/actor từ model; effective-permission snapshot chỉ phục vụ provenance;
    4. kiểm tra required context và resource thuộc workspace;
    5. rehydrate membership/effective permissions hiện hành và revalidate resource/context version trước **mỗi attempt, resume và side effect**; quyền bị revoke phải có hiệu lực mà không chờ run kết thúc;
    6. kiểm tra risk/approval và idempotency;
    7. reserve runtime/cost budget, áp timeout/cancellation;
    8. execute handler với provider-native timeout/cooperative cancellation; compute không ngắt được phải chạy process-isolated hoặc có commit fence để late result không được ghi sau timeout/cancel;
    9. validate typed output/size/PII policy;
    10. tạo canonical evidence, trace và usage record.
  - Chuyển các nhóm hiện có trong `backend/src/agents/tools/` theo batch: core profile → quality → governance → statistics/tests → drift → retrieval/analysis. Mỗi batch có manifest snapshot test và parity test với output cũ.
  - Sửa `tools/common.py::active_run` và context hiện tại: mọi repository read phải nhận cả `profile_run_id` và `workspace_id`; tool gọi ngoài API pre-check vẫn phải fail closed.
  - Tách counter trong state/runtime thành `steps_used`, `tool_calls_used`, `model_calls_used`, `retrieval_calls_used`, `tokens_used`, `cost_used`; không dùng `tool_calls` để đếm lẫn graph node hoặc retrieval.
  - `cost_class`/worst-case estimate trong manifest phải đưa mọi hosted capability (LLM, embedding/retrieval, storage, external API) qua cùng atomic reserve/commit ledger; không chỉ model wrapper mới bị cost cap.
  - Không expose handler nội bộ hoặc calculator ngoài registry. Calculator/expression AST không nằm trong scope này; derived metric chỉ được thêm qua một dedicated typed deterministic capability đã code-review/version, không qua expression/code string trong plan.
  - Thêm permission/projection rõ trong `backend/src/services/permissions.py`; capability nghiệp vụ tiếp tục yêu cầu permission hiện có như `profile.read`, `analysis.run`, `report.draft.write`:

    | Role | Agent visibility/decision |
    | --- | --- |
    | Viewer | Chỉ `published_report_provenance` đã suppress/mask qua `report.published.read`; không gọi generic run/trace/evidence endpoints. |
    | Analyst | `agent.run.read`, `agent.trace.read` cho resource mà Analyst đã có permission trong workspace; `agent.approval.decide` chỉ cho semantic/analysis action được policy cho phép. |
    | Admin | Analyst + `agent.trace.debug.read`, DLQ/redrive/circuit-breaker operations và approval quản trị; vẫn không được xem secret/raw row/chain-of-thought. |

    API `GET /agent-runs/*` không phải Viewer API; published report dùng projection riêng, không lộ tool args, internal errors hoặc profile internals.
  - Acceptance criteria:
    - 100% tool LLM có manifest/version/input-output schema và dispatcher path duy nhất.
    - Invalid input/output, thiếu permission/context, cross-workspace, timeout và approval-required đều có machine-readable error, trace và không chạy handler.
    - Snapshot registry hash cho cùng release là deterministic; đổi schema/behavior bắt buộc bump version và tạo regression result.

[ ] 4. Xây deterministic verifier/evidence checker và chặn answer không có evidence.

  - Tạo `backend/src/agents/verification/` gồm:
    - `schemas.py`: `AnswerDraft`, `AnswerClaim`, `EvidenceRef`, `VerificationResult`, `Violation`.
    - `claim_extractor.py`: lấy claim từ structured output và scan lại numeric/citation token trong rendered answer.
    - `evidence_checker.py`: scope, field/value/unit/approximation/source hash/citation validation.
    - `contradictions.py`: chuẩn hóa metric + scope + filters để tìm kết quả xung đột.
    - `policies.py`: PII, overclaim, sample/full, external-knowledge và no-tool rules.
    - `verifier.py`: deterministic decision `passed | needs_more_evidence | blocked`.
  - Yêu cầu synthesis tạo structured `AnswerDraft` trước khi render text:

    ```text
    answer_kind
    claims[]:
      claim_id, kind, text, value/unit (nếu có), evidence_ids[], is_approximate
    limitations[]
    citations[]
    ```

    LLM chỉ đề xuất text bên trong từng structured claim. Final renderer chỉ ghép các claim đã verify bằng template/control text cùng limitations/citations; không chấp nhận một free-form `answer_text` song song. Malformed claim hoặc prose/span không map tới verified claim làm output fail closed, tránh assertion định tính bị giấu ngoài `claims[]`.
  - Thực hiện các check bắt buộc:
    - mọi numeric/factual dataset claim có ít nhất một canonical evidence ID;
    - evidence thuộc đúng workspace, profile run, analysis session/context/execution đã pin;
    - giá trị và đơn vị khớp evidence, không tự làm tròn làm đổi nghĩa;
    - sample evidence không được render như population exact; answer phải có `≈`/“ước lượng từ mẫu” và limitation;
    - PII không xuất hiện dạng value và không được dùng làm aggregate/group/filter;
    - aggregate theo quasi-identifier/tổ hợp dimension phải qua minimum-group-size/small-cell suppression trước khi vào answer, public evidence hoặc published provenance; ngưỡng thuộc workspace policy và không được model hạ;
    - dataset fact không được grounded chỉ bằng external knowledge hoặc narrative do LLM sinh;
    - citation tồn tại, được dùng đúng loại và không trỏ sang profile khác;
    - answer không kết luận vượt quá data (causation, domain semantics, exactness, completeness);
    - cùng metric/scope không có values hoặc conclusions mâu thuẫn chưa được giải thích.
  - No-tool/no-evidence guard:
    - câu định lượng chỉ được trả factual answer khi có canonical evidence;
    - social/clarify/policy response được phép không có tool nhưng phải được gắn `answer_kind` tương ứng;
    - model không gọi tool thì executor tự chọn deterministic minimum capability từ plan hoặc trả “chưa đủ evidence”, không chấp nhận prose có số.
  - Khi `needs_more_evidence`, cho phép tối đa một recovery pass chỉ nếu còn step/tool/model/time/cost budget; plan bổ sung vẫn phải validate. Hết budget hoặc verifier lặp lại violation thì trả bounded fallback với limitation, không loop vô hạn.
  - Với vector Q&A, chỉ index deterministic profile facts làm primary evidence; `narrative_report` do LLM tạo phải được đánh dấu secondary/non-authoritative hoặc loại khỏi dataset-fact evidence.
  - Thêm node `verify_answer` vào Q&A graph trước terminal và một verifier hook trước report publish/export.
  - Chạy verifier ở `shadow` trước, lưu false positive/negative vào eval; chỉ đổi sang `enforce` khi gate mục 5 đạt.
  - Acceptance criteria:
    - Không numeric answer nào đi qua khi thiếu/mismatch/cross-scope evidence.
    - Sample/full, PII, contradiction, unsupported claim và citation mutation đều có unit test deterministic.
    - Verifier không gọi LLM và cùng input/version luôn cho cùng output/hash.

[ ] 5. Xây evaluation framework cố định và biến nó thành cổng regression chính.

  - Tạo cấu trúc:

    ```text
    evals/
      schemas.py
      runner.py
      scorers.py
      reporters.py
      cases/
        quantitative.yaml
        ambiguity.yaml
        pii_policy.yaml
        prompt_injection.yaml
        tenant_isolation.yaml
        llm_unavailable.yaml
        tool_failure_recovery.yaml
        sampling.yaml
        evidence_citations.yaml
        version_regression.yaml
      fixtures/
      mocked_transcripts/
      baselines/
      reports/                 # gitignored, trừ baseline manifest đã duyệt
    ```

  - Mỗi case pin: fixture hash, workspace/user/role, profile mode, question/goal, expected answer constraints, numeric tolerance, required/forbidden capability, expected evidence coordinates, policy expectations, injected failures, plan/tool/prompt/model versions và budget.
  - Bao phủ tối thiểu các nhóm người dùng yêu cầu:

    | Nhóm | Assertion chính |
    | --- | --- |
    | Định lượng | Số/đơn vị/tolerance đúng và mỗi claim có evidence. |
    | Mơ hồ | Hỏi lại đúng một câu, không đoán tool/cột/scope. |
    | PII | Mask output; block raw value và PII group/filter. |
    | Prompt injection | Chặn instruction override ở question, column/data value và retrieval content. |
    | Tenant/scope | Hai workspace, biết chính xác ID vẫn không đọc/trace/retry/approve chéo tenant. |
    | LLM unavailable | Deterministic compute/fallback hoạt động; không claim giả. |
    | Tool error/timeout | Retry đúng classification/backoff rồi fallback đúng policy; DLQ/redrive assertions chỉ thành blocking sau khi phase reliability cung cấp feature. |
    | Sample/full | Sample luôn approximate; full không bị gắn approximate sai. |
    | Citation/evidence | Missing, swapped, stale và contradictory evidence bị verifier chặn. |
    | Version regression | So sánh prompt/model/tool/runtime manifest với baseline. |

  - Case có `requires_features`; mỗi phase/release profile khai báo feature set bắt buộc. Runner chỉ skip có lý do trước phase sở hữu feature, fail nếu required feature bị tắt/case vẫn skip, và final go/no-go chạy zero-skip cho queue/retry/DLQ/circuit/cost. Nhờ đó flag `off` không thể che implementation thiếu.
  - Định nghĩa scorer máy kiểm tra được, lưu riêng và không che lỗi policy bằng một điểm trung bình:

    | Metric | Miền/cách tính |
    | --- | --- |
    | `answer_correctness` | `[0,1]`: số expected predicates pass / tổng predicates; numeric predicate dùng tolerance đã pin trong case. |
    | `evidence_groundedness` | `[0,1]`: factual claims được support bởi valid evidence / tổng factual claims; factual answer rỗng evidence là `0`. |
    | `tool_selection_accuracy` | Max F1 giữa executed capability set và các acceptable sets; gọi bất kỳ forbidden capability làm case fail bất kể F1. |
    | `policy_compliance` | Binary; bất kỳ PII/scope/injection/approval/budget violation nào là `0`. |
    | `failure_recovery` | Số expected transition/attempt/fallback assertions pass / tổng assertions; terminal state sai là `0`. |
    | `latency_ms` | Raw + `p50/p95`, không gộp vào correctness score. |
    | `token_cost` | Input/output/cached/reasoning tokens + cost/currency/pricing-catalog version; unknown usage được đánh dấu, không tự coi là `0`. |

    Runner exit khác `0` khi hard-gate case fail, required metric thiếu, forbidden action chạy, manifest mismatch không được duyệt hoặc case required bị skip.
  - Gate đề xuất:
    - deterministic quantitative correctness/groundedness và policy/tenant/PII/injection: `100%`;
    - không capability bị cấm hoặc cross-scope invocation nào được thực thi;
    - failure cases đạt terminal state đúng, không step treo;
    - token/cost không vượt hard budget; latency p95 không block trên GitHub shared runner mà chạy scheduled trên runner cố định với warm-up, số lần lặp/sample tối thiểu và threshold versioned;
    - live-model suite ban đầu là scheduled/advisory; chỉ promoted thành gate sau khi đủ ổn định, còn offline mocked-model suite luôn là blocking CI.
  - Offline deterministic suite phải chặn outbound network, dùng fixed seed/fake clock/fake scheduler và chạy lặp hai lần cho cùng manifest + score. Failure injection đi qua provider adapters với typed error taxonomy; không dùng `sleep` thật hoặc lỗi mạng ngẫu nhiên để test backoff.
  - Baseline governance: baseline pin commit/release, fixture/schema/registry manifest, người duyệt, ngày hết hạn và rationale. Update baseline cần machine diff + code-owner approval; không cho runner tự ghi đè baseline khi score giảm.
  - Eval JSON/Markdown artifact phải qua canary PII/secret/raw-prompt/retrieval-chunk scan, có retention và access policy; CI artifact không chứa raw dataset hoặc credential.
  - Tạo test files tương ứng:
    - `tests/test_services/test_agent_trace.py`
    - `tests/test_services/test_verifier.py`
    - `tests/test_agents/test_no_tool_answer_guard.py`
    - `tests/test_agents/test_tool_failure_recovery.py`
    - `tests/test_api/test_agent_runs.py`
    - `tests/test_api/test_tenant_isolation.py`
    - `tests/test_api/test_approval_policy.py`
    - `tests/test_migrations/test_upgrade_paths.py`
  - Thêm GitHub Actions với PostgreSQL service tại `.github/workflows/agent-quality.yml`, pin Python 3.11/Node 20/pnpm 9, đợi PostgreSQL ready và tạo database riêng cho migration/app/eval. **Migration job chạy trước app test** trên database độc lập để `create_all()` không che lỗi. Matrix migration phải có: empty DB → head; legacy fixture qua từng expand/dual-write/backfill/enforce gate → head; một Alembic head duy nhất; NOT NULL/FK/index/tenant policy assertions; và app/worker N-1 đọc **và chạy critical write paths** trên additive schema N trước khi drain/enforce. E2E job phải start/health-check FastAPI và Next.js, seed fixture/workspace/users rồi mới chạy Playwright; không phụ thuộc backend chạy sẵn ngoài CI.
  - Blocking commands minh họa (workflow/script chịu trách nhiệm cấp `P170_TEST_DATABASE_URL` riêng và seed backend):

    ```powershell
    python -m pytest -q tests/test_migrations/test_upgrade_paths.py
    # Job backend chỉ bắt đầu sau khi migration matrix phía trên pass.
    python -m compileall -q backend/src
    python -m pytest -q
    python -m evals.runner --suite deterministic --fail-on-regression
    cd frontend
    pnpm install --frozen-lockfile
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    pnpm exec playwright install --with-deps
    pnpm test:e2e
    ```

  - Chốt Ruff config/baseline riêng trước khi thêm `ruff check` thành blocking gate; không trộn cleanup lint lớn với refactor runtime.
  - Acceptance criteria:
    - Một lệnh tạo JSON/Markdown report có run manifest và so được hai phiên bản prompt/model/tool.
    - Offline suite chạy hai lần trong zero-network mode cho score/manifest giống nhau; artifact scan không phát hiện canary secret/PII.
    - Mọi bug production liên quan agent phải có eval case cố định trước khi đóng issue.
    - Planner/verifier feature flag không được bật nếu deterministic suite chưa xanh.

[ ] 6. Xây durable execution/cost substrate, planner schema, per-step executor và bounded ReAct state machine.

  - Trước khi bật planner, tạo minimal durable substrate tại `backend/src/services/jobs.py` và worker entrypoint, cùng additive tables `agent_jobs`, `agent_job_attempts`, `agent_usage_ledger`, `idempotency_records` và transactional outbox. Planner/deep analysis không được pilot nếu queue lease và atomic user/workspace budget reservation chưa chạy.
  - PostgreSQL queue contract: delivery **at-least-once**; claim bằng `FOR UPDATE SKIP LOCKED`; record có `available_at`, priority, lease owner/expiry, `lease_epoch` fencing token, max attempts và heartbeat dùng database time; một claim chỉ thuộc một active lease. Mọi commit step/evidence/outbox/usage phải conditional theo current epoch để stale worker không late-commit sau reclaim. Side effect không dựa vào queue để exactly-once mà dùng idempotency record/outbox commit cùng transaction với step state. Remote provider phải nhận cùng stable operation/idempotency key hoặc có reconciliation/compensation contract; nếu provider không bảo đảm, crash sau remote success tạo trạng thái `indeterminate/needs_reconciliation` và cấm automatic retry/redrive.
  - Idempotency khóa theo `(workspace_id, operation, idempotency_key)` và lưu request hash: cùng key+cùng payload replay stored result; cùng key+khác payload trả `409`; TTL/retention dài hơn maximum retry/redrive window.
  - Usage ledger reserve worst-case atomically cho cả user và workspace trước priced capability, commit/reconcile actual sau call và release phần dư. Reservation có owner attempt, lease/expiry và reconciler để worker crash không giữ quota vĩnh viễn. Concurrent workers không được vượt hard cap; unknown/stream/error usage dùng pricing snapshot + conservative reconciliation thay vì ghi cost `0`.
  - Async deep-analysis create trả `202`, `Location: /api/v1/agent-runs/{id}`, `Retry-After`, `agent_run_id` và status URL; sync/queue decision dựa deterministic workflow type/deadline, không do model quyết định. Terminal states thống nhất: `completed | failed | cancelled | rejected`; `needs_reconciliation` là paused operational state chỉ Admin/reconciler được resolve.
  - Tạo `backend/src/agents/planner/`:
    - `schemas.py`: `PlanSpec`, `StepSpec`, `InputBinding`, `RetryPolicy`, `ApprovalPolicy`, `AcceptanceCriterion`, `PlanBudget`.
    - `templates.py`: deterministic plan templates cho intent phổ biến.
    - `validator.py`: schema/DAG/capability/permission/context/risk/budget validation.
    - `planner.py`: map goal thành typed plan; model chỉ được chọn registered capability/skill và fill schema.
  - Plan contract bắt buộc `extra="forbid"` và không có field `sql`, `query_text`, `code`, `script`, `command`, `expression`, template evaluation hoặc executable callback:

    ```text
    PlanSpec
      schema_version, plan_version, objective
      workspace/resource/context bindings (server-pinned)
      steps[]
      budgets: max_steps, max_tool_calls, max_model_calls,
               max_input_tokens, max_output_tokens, max_cost, deadline
      policy_version, capability_registry_hash

    StepSpec
      step_id
      type: capability | skill | verify | approval
      target_name + target_version
      input_bindings: chỉ JSON Pointer từ request/context/evidence/step output allowlist
      depends_on[]
      reason_code + reason_summary
      acceptance_criteria[]
      timeout_ms, retry_policy, approval_policy
    ```

  - Validator chạy theo thứ tự:
    1. Pydantic/schema và payload-size validation;
    2. unique step ID, missing dependency và cycle detection;
    3. capability/skill/version tồn tại trong snapshot registry;
    4. input binding chỉ trỏ namespace được phép và không tự evaluate string;
    5. required context/resource cùng workspace và context version không stale;
    6. effective permissions cho toàn plan;
    7. risk/side-effect/approval policy;
    8. max step/tool/model/token/cost/deadline và per-step runtime;
    9. acceptance criteria thuộc deterministic allowlist;
    10. cấm mọi raw SQL/code/shell/notebook/source-path payload ở mọi nested field.
  - Policy khởi điểm, cấu hình được nhưng luôn hữu hạn:

    | Workflow | Max steps | Max tool calls | Max model calls | Retry/step | Deadline |
    | --- | ---: | ---: | ---: | ---: | ---: |
    | Quantitative Q&A | 8 | 10 | 6 | 1 | 60 giây |
    | Deep analysis | 20 | 30 | 12 | 2 | 30 phút, bắt buộc queue |
    | Profiling | Fixed node list | Không do planner quyết định | Bounded theo node | Chỉ transient | Job policy |

    `max_cost` là hard cap server-side bắt buộc, lấy giá trị nhỏ nhất giữa run, user và workspace remaining budget. Production startup phải fail nếu bật planner mà chưa cấu hình finite quick/deep cost ceiling.
  - Tạo `backend/src/agents/runtime/executor.py` với step state machine:

    ```text
    pending -> ready -> awaiting_approval -> running -> cancelling
                    -> retry_wait -> ready
                    -> succeeded | failed | skipped | cancelled | needs_reconciliation
    ```

    Ready chỉ khi toàn bộ dependency succeeded; attempt được persist trước khi chạy; retry/resume tiếp tục đúng step, không chạy lại step succeeded; side-effect step phải có idempotency key. `needs_reconciliation` block dependent steps cho tới khi provider result được đối chiếu hoặc compensation được duyệt.
  - Q&A bounded ReAct trở thành explicit state machine:

    ```text
    guard/classify
      -> build deterministic/typed plan
      -> validate plan
      -> execute ready capability
      -> validate result + add evidence
      -> next bounded step (nếu cần)
      -> synthesize AnswerDraft
      -> deterministic verify
      -> one bounded recovery OR final answer
    ```

  - `qa_router`, `qa_structured`, retrieval và analysis execution đều phát trace; tool result phải qua output validation. Không expose model scratchpad/chain-of-thought; chỉ plan reason summary và rule/decision code.
  - Giữ profiling graph cố định. Thêm global error router và terminal `failed/cancelled`; `finalize_profile_node` tuyệt đối không ghi `completed` nếu state có error.
  - Deep Analysis dùng planner/executor trên Analysis Session đã có approved context + passed/warning quality gate; `blocked` không được execute, còn `warning` bắt buộc propagate issue/limitation vào evidence, answer và report. Quick bounded execution hiện tại vẫn là compatibility path cho tới khi parity eval pass.
  - Acceptance criteria:
    - Plan có cycle, unknown capability, thiếu permission, stale context, quá budget, side effect không approval hoặc bất kỳ SQL/code field nào bị reject trước execution.
    - Sau lease expiry theo configured recovery SLA, orphan attempt được đóng `abandoned`, job được reclaim, step đã succeeded không chạy lại; side effect đã commit chỉ replay stored idempotent result.
    - Hết timeout/cost/tool/model budget tạo terminal result có limitation, không loop hoặc âm budget.

[ ] 7. Mở rộng HITL thành approval policy chung và xây UI plan/trace/review.

  - Tạo `ApprovalPolicyEngine` dùng manifest risk + side effect + context + workspace policy:

    | Trường hợp | Mặc định |
    | --- | --- |
    | Read-only data access, risk `read`, không side effect, scope rõ | Auto-run sau permission validation; không áp dụng cho metadata confirmation. |
    | Semantic proposal/decision | Proposal generation có thể auto-run, nhưng metadata được downstream consume phải ở trạng thái đã review; trường hợp mơ hồ luôn yêu cầu Analyst explicit approval. |
    | PII/candidate-key confirmation | Luôn yêu cầu người duyệt; không auto-approve. |
    | Export/generate report | Workspace-configurable review; published viewer export vẫn theo permission hiện tại. |
    | Mọi capability có side effect hoặc risk medium/high | Bắt buộc approval. |

  - Approval record phải pin `plan_hash`, `plan_version`, `step_id`, `capability_version`, context/evidence version và policy version. Sửa plan/context hoặc bump capability làm approval cũ invalid; không tái dùng approval stale.
  - Thêm API idempotent, tenant-scoped:
    - `POST /agent-runs/{run_id}/approvals/{approval_id}/approve`
    - `POST /agent-runs/{run_id}/approvals/{approval_id}/reject`
    - `POST /agent-runs/{run_id}/plan/revise`
    - `POST /agent-runs/{run_id}/resume`
    - `POST /agent-runs/{run_id}/cancel`
  - Hỗ trợ pause, resume, reject và revise plan. Reject tạo terminal hoặc quay về plan revision theo policy; không âm thầm bỏ qua step bắt buộc.
  - Frontend:
    - thêm `frontend/src/components/agent-trace.tsx`, `agent-plan.tsx`, `approval-panel.tsx`, `verification-badge.tsx`;
    - mở rộng `frontend/src/lib/types.ts`, `analysis-types.ts`, `api.ts`, `sse.ts`;
    - thêm trace drawer cho `/chat`, plan/approval timeline cho `/analyses/{sessionId}`, và read-only provenance cho published report;
    - SSE event tối thiểu: `run`, `plan`, `step`, `tool`, `approval_required`, `verification`, `done`, `error`; mỗi event có monotonic ID, hỗ trợ `Last-Event-ID`/cursor replay, heartbeat, authorization recheck khi reconnect và terminal polling fallback.
  - UI approval phải hiển thị trước khi quyết định:
    - Agent dự định làm gì;
    - vì sao cần làm (reason summary, không phải chain-of-thought);
    - profile/context/evidence nào sẽ được đọc;
    - output/acceptance criteria dự kiến;
    - risk, side effect, limitation, timeout và budget còn lại.
  - Thêm stale-version, double-submit, approve/reject race, actor permission, self-approval policy và cross-workspace tests.
  - Acceptance criteria:
    - Sensitive step không thể chạy qua API, worker hoặc resume path nếu thiếu valid approval.
    - Người dùng thấy được pending/running/retry/failed/succeeded mà không thấy nội dung nhạy cảm.
    - Cancel/reject có hiệu lực ở checkpoint kế tiếp và terminal trace phản ánh đúng actor/reason.

[ ] 8. Xây skill như versioned workflow có acceptance criteria, không phải prompt alias.

  - Chỉ bắt đầu sau khi capability registry, verifier và planner/executor ổn định. Tạo `backend/src/agents/skills/` với `schemas.py`, `registry.py` và từng workflow versioned.
  - `SkillManifest` tối thiểu:

    ```text
    name, version, description
    input_schema, output_schema
    workflow_steps (registered capability/skill refs)
    permissions, risk_level, side_effects
    required_context, budgets, approval_policy
    acceptance_criteria[]
    compatible_capability_versions
    ```

  - Implement năm skill đầu tiên:

    | Skill | Workflow boundary | Acceptance criteria chính |
    | --- | --- | --- |
    | `profile_dataset` | Adapter versioned quanh fixed profiling graph. | Profile terminal hợp lệ; metrics deterministic; pending metadata đi HITL; trace/evidence đầy đủ. |
    | `diagnose_data_quality` | Profile/quality capabilities + deterministic ranking. | Mọi issue có rule, severity, evidence; không raw row/PII. |
    | `compare_profile_drift` | Validate same dataset → drift capabilities. | Baseline/current đúng workspace/dataset; findings có metric/evidence/version. |
    | `answer_business_question` | Approved context → quality gate → bounded plan → aggregate evidence → verifier. | `blocked` không execute; `warning` propagate limitation; answer passed verifier; sample limitation đúng; không SQL/code. |
    | `generate_report` | Chỉ dùng verified executions/evidence → draft artifact. | Section đều truy về evidence; approval/export policy pass; immutable version/hash. |

  - Skill registry snapshot/hash được lưu vào run; bump skill version khi workflow/acceptance criteria thay đổi. Prompt update đơn thuần không được âm thầm thay behavior của skill version cũ.
  - Skill output phải typed và có verification status; completion chỉ xảy ra khi acceptance criteria deterministic pass. “Model nói đã xong” không phải completion signal.
  - Không cho model tạo skill/capability mới trong runtime. Chỉ code review/release process mới cập nhật registry.
  - Acceptance criteria:
    - Mỗi skill có unit contract, golden trace và eval scenario.
    - Có thể resume/retry từng capability step bên trong skill mà không chạy lại side effect đã commit.
    - `profile_dataset` vẫn có topology cố định và không biến thành free-form ReAct.

[ ] 9. Phân lớp memory có governance và không lưu toàn bộ chat mặc định.

  - Map bốn lớp memory vào lifecycle/quyền rõ ràng:

    | Lớp | Nội dung | Persistence/policy |
    | --- | --- | --- |
    | Run memory | Plan, step state, attempts, evidence, usage, checkpoints. | Theo retention của agent run; luôn tenant-scoped. |
    | Session memory | Analysis goal, approved context, selected evidence/execution và user decisions. | Gắn Analysis Session; chỉ lưu structured refs, không copy toàn chat. |
    | Workspace memory | Business definition/glossary đã được Analyst/Admin xác nhận. | Versioned, có provenance, approval, audit, revoke và conflict state. |
    | Personal memory | Preference không nhạy cảm do user chủ động lưu. | Mặc định off; opt-in, TTL, list/delete/export; không lưu PII/secret/raw dataset. |

  - Tạo `workspace_business_definitions`, `workspace_definition_versions` và nếu được bật sau này `personal_memory_items`; không dùng vector index toàn cục cho tenant memory.
  - Workspace definition chỉ được tạo/sửa qua typed API và approval; retrieval bắt buộc filter `workspace_id`, status `approved`, version active và permission. Conflicting definitions không được model tự merge.
  - Memory injection có max item/character/token budget và trace evidence refs. History chat từ browser tiếp tục là short-term context; backend không tự promote message thành long-term memory.
  - Thêm UI quản lý definition/provenance và personal opt-in/delete trước khi bật feature flag. Guest không có personal/workspace long-term memory.
  - Acceptance criteria:
    - Switch workspace/account xóa in-memory/cache context và không retrieve memory tenant cũ.
    - Không có personal memory write nếu thiếu explicit user action/consent.
    - Xóa/revoke memory làm request kế tiếp không còn retrieve item, đồng thời giữ audit tối thiểu không chứa content nhạy cảm.

[ ] 10. Hoàn thiện production reliability, migration/rollback và staged rollout.

  - Hardening queue/ledger tối thiểu đã xây ở mục 6; thêm dead-letter queue (DLQ), circuit-breaker state, operational APIs/metrics và mở rộng worker sang profiling. Domain API tiếp tục không phụ thuộc backend queue cụ thể.
  - Không âm thầm đổi contract `POST /profile` hiện trả `201 ProfileResponse`. Thêm endpoint/version hoặc explicit async preference (ví dụ `POST /profile-jobs`) trả `202`, `Location`, `Retry-After` và status URL; giữ sync endpoint dưới feature flag cho tới khi frontend polling/approval flow và compatibility eval pass. Quick Q&A chỉ sync khi workflow/deadline/budget policy cho phép; không để model tự chọn sync/async.
  - Thêm bảng/migration tiếp theo:
    - `agent_dead_letters` liên kết original job/attempt;
    - `service_circuit_state` dùng chung giữa replica production (process-local chỉ được phép ở dev/test);
    - memory tables chỉ khi phase 9 được bật.
  - Reliability contract:
    - cancellation chuyển qua `cancelling`; epoch được check giữa steps, trước model/tool và trong compute chunk có thể ngắt. Call/remote side effect không hủy được phải timeout/ignore late result và commit fence; nếu outcome chưa xác minh thì vào `needs_reconciliation`, không được ghi terminal `cancelled`, retry hoặc redrive như thể chưa có effect;
    - exponential backoff + jitter chỉ cho typed transient errors (transport timeout, throttling/`Retry-After`, selected 5xx); policy/permission/schema/cancelled/non-idempotent error terminal ngay. Backoff có max, max attempts và clamp theo remaining deadline;
    - per-model/tool runtime lấy từ config/manifest; plan deadline luôn là hard cap;
    - idempotency contract mục 6 áp cho create profile, create agent run, analysis execution, approval và mọi side effect; outbox/step commit là cùng transaction;
    - worker lease/heartbeat phát hiện orphan, đóng attempt cũ `abandoned` và resume từ persisted step; recovery SLA được cấu hình/đo theo lease TTL + heartbeat thay vì chờ vô hạn;
    - circuit breaker riêng cho LLM, retrieval và storage, với shared atomic version/CAS, versioned failure threshold/window, cooldown, half-open concurrency, error classes, manual reset permission/audit và trace event. Test hai replica cùng trip, open fast-fail không reserve/retry, đúng số half-open probe, success đóng và failure mở lại;
    - transition `job/attempt → dead_lettered`, DLQ record và trace/outbox commit atomically. Admin redrive có retention, max count, permission/audit và unique idempotency constraint; hai redrive đồng thời chỉ tạo một job/attempt mới liên kết original, không tự chạy lại side effect đã commit/indeterminate;
    - reserve worst-case cost trước model call, commit/reconcile actual usage sau stream/success/error, release phần dư; pricing version/currency/precision được pin và race nhiều worker có integration test.
  - Sửa error flow profiling: lỗi ingest/compute không được đi qua unconditional edge rồi bị `finalize_profile_node` ghi `completed`; thêm terminal `failed`, cleanup và retry policy rõ ràng.
  - Version compatibility:
    - worker chỉ claim run có supported runtime/plan/schema version;
    - deploy mới đọc được ít nhất một version cũ trong compatibility window;
    - prompt/model/tool/skill version đã pin không bị đổi giữa resume;
    - unsupported old run được migration command hoặc safe terminal state, không âm thầm chạy với code mới.
  - Rollout không phá dữ liệu:
    1. deploy additive schema + trace shadow, planner/verifier off;
    2. dual-write trace cho nội bộ và kiểm tra completeness/redaction;
    3. verifier shadow, so false positive với eval; sau đó enforce cho quantitative Q&A;
    4. capability dispatcher mới qua compatibility adapter, parity gate từng domain;
    5. sau khi durable queue + atomic cost ledger mục 6 pass crash tests, planner chỉ cho deep-analysis pilot workspace; quick path cũ là rollback;
    6. bật approval UI rồi mới cho capability side effect;
    7. bật profiling async + circuit breaker/DLQ hardening cho pilot, kiểm tra cancel/retry/redrive;
    8. bật skills; workspace memory sau cùng; personal memory vẫn off cho tới khi có explicit product approval.
  - Rollback dùng feature flag và release trước, giữ nguyên additive tables/trace; không drop run/step/evidence hoặc chạy destructive downgrade trong sự cố. Job đang chạy phải pause/cancel theo runtime compatibility, không chuyển engine giữa step.
  - Update `README.md`, `docs/summary.md`, `.env.example`, `config.yaml` và runbook với trace semantics, approval policy, queue worker, cost quota, migration, DLQ replay và incident handling.
  - Go/no-go cuối cùng:
    - Một trace hoàn chỉnh trả lời đủ năm câu hỏi audit của yêu cầu và không lộ dữ liệu bị cấm.
    - Mọi capability/skill/plan được version và validate; không có raw SQL/code path.
    - Quantitative answer thiếu/sai/cross-scope/sample-mislabeled evidence bị chặn deterministic.
    - Pause/resume/retry/cancel/idempotency/DLQ/cost cap hoạt động sau worker restart.
    - Crash matrix pass tại: trước claim, sau attempt insert, giữa tool call, sau remote side effect trước DB commit, sau commit trước ACK, sau lease reclaim với stale-worker late result, trong budget reservation và trong DLQ redrive; không double-commit, giữ quota vĩnh viễn hoặc mất terminal/indeterminate provenance.
    - Hai-user/hai-workspace matrix, PII, injection và policy suite đạt 100%.
    - Offline eval + backend/frontend/migration CI xanh với final release profile zero-skip; live eval không vượt approved latency/token/cost regression budget.

## Open questions

- Production có chấp nhận PostgreSQL lease queue cho giai đoạn đầu (khuyến nghị để giảm thêm hạ tầng), hay đã có Redis/managed queue chuẩn cần dùng ngay? - Chấp nhận PostgreSQL lease queue.
- Workspace memory sẽ do Analyst được tự approve hay yêu cầu Admin/separation-of-duties? Personal memory được khuyến nghị giữ `off` ngoài phạm vi rollout đầu. - workspace memory do analyst được tự ap

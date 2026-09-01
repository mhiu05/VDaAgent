# Agent, QA, retrieval và evidence

> Đã đối chiếu với LangGraph nodes, tool registry, validator và runtime trace hiện tại ngày 2026-09-01.

## Profiling graph

LangGraph tại [`backend/src/agents/graph.py`](../../backend/src/agents/graph.py) điều phối workflow cố định:

```text
ingest → compute_stats → propose_metadata → hitl_review
  ├─ reject/edit → propose_metadata
  ├─ request_test → deep_analysis → hitl_review
  └─ confirm → summarize → optional QA → finalize
```

`ingest` gọi file-backed DuckDB profiling và đưa aggregate vào graph state; `compute_stats` chỉ persist projection đó. Candidate key được tính deterministic trong DuckDB, semantic type ưu tiên rule và chỉ nhờ LLM tinh chỉnh phần chưa chắc chắn, PII dùng heuristic tên cột + regex trên sample giới hạn. Không đưa DataFrame lớn vào checkpoint.

`hitl_review` có thể interrupt. Default hiện chỉ cho semantic-type confidence ≥ 0,95 auto-confirm; candidate key và PII chờ Analyst. Đây là default cấu hình, chưa phải schema invariant vì `HITL_LOW_RISK_TYPES` chưa có allow-list. Resume được enqueue và worker gọi `Command(resume=...)` trên thread `profile:{run_id}`.

## Native skills và tool registry

Catalog native skill v1 gồm:

| Skill | Chế độ |
| --- | --- |
| `profile-dataset` | workflow `POST /api/v1/profile` |
| `diagnose-data-quality` | read-only tool bundle |
| `compare-profile-drift` | read-only tool bundle |
| `answer-business-question` | workflow `POST /api/v1/qa` |
| `generate-report` | report workflow |

API `/api/v1/agent-skills` trả catalog/detail và cho inspect tool bundle sau khi kiểm tra workspace/profile scope. Skill file là playbook; enforcement thật nằm ở capability dependency, tool dispatcher và repository predicate.

Tool registry dùng schema có giới hạn và server inject `profile_run_id`. Các tool đọc profile readiness, column stats, quality, governance, drift và statistic artifact; không nhận raw SQL/Python, không trả raw PII.

## QA routing

`POST /api/v1/qa` và `/qa/stream` dùng cùng graph:

```text
question
  → input guardrail
  → router
      ├─ blocked → deterministic refusal
      ├─ ambiguous → clarification
      ├─ quantitative → structured tool route
      └─ qualitative/chart insight → scoped retrieval route
  → evidence validation
  → output guardrail
```

Question tối đa 2.000 ký tự; request nhận tối đa 20 history message và graph dùng 12 message cuối. Router giữ execution binding do server inject khi `response_mode=chart_insight`.

Candidate-key và broad data-quality intent được server prefetch tool bắt buộc. Với request đơn-intent, renderer deterministic có thể trả answer trực tiếp, tránh một model call không cần thiết. Các quantitative intent khác cho model chọn tool trong budget, nhưng calculator chỉ được dùng sau khi đã có metadata evidence trong cùng lượt.

## Evidence validation

[`qa_validation.py`](../../backend/src/services/qa_validation.py) là trust boundary deterministic. Một answer chỉ được `verified` khi:

- có `profile_run_id` và tool result cùng run;
- nếu có workspace context thì result/source cùng workspace;
- tool envelope không có error, có evidence và source status thành công;
- artifact đúng với câu hỏi (candidate key, quality issue, correlation, column stats...);
- số xuất hiện trong answer có mặt trong tool data;
- citation `[S<n>]` tham chiếu source hợp lệ.

Malformed/stale/fake evidence, wrong artifact, số không được hỗ trợ hoặc citation sai đều chuyển sang `no_evidence` và dùng thông báo abstain ổn định. Validator không đọc raw row hoặc chain-of-thought.

## Retrieval

`retrieval_documents` hỗ trợ hybrid sparse/dense retrieval:

- profile/report document luôn scope theo workspace và, khi có, Profile Run;
- external-knowledge document có thể global với `workspace_id = null`, chỉ được dùng khi effective config bật;
- embedding provider có thể local, OpenAI, Voyage hoặc none;
- sparse path vẫn chạy khi embedding lỗi;
- profile và external search có thể chạy song song;
- kết quả được giới hạn top-k, số chunk/source và context chars.

Chart insight có thể dựa hoàn toàn vào Official execution được bind, kể cả không có profile-index hit. Preview không đủ điều kiện thay thế Official.

## Trace và observability

Agent runtime lưu run, plan, step, invocation, evidence và trace event. Trace mode:

- `off`: không persist runtime trace;
- `shadow`: lỗi trace không làm request fail;
- `required`: lỗi persistence làm request fail closed.

Trace sanitizer giới hạn depth/size và bỏ token, secret, prompt/message đầy đủ, raw row, local path cùng payload lớn. LangSmith là projection best-effort; adapter hiện luôn hide inputs/outputs và chỉ gửi metadata allow-list.

AI latency ledger ghi một record an toàn cho QA/chart planner với `router_ms`, `planner_ms`, `retrieval_ms`, `tools_ms`, `evidence_ms`, `final_llm_ms`, `validation_ms`, TTFT, call count và token count nếu provider trả usage. [`scripts/benchmark_ai_latency.py`](../../scripts/benchmark_ai_latency.py) chỉ benchmark control-flow bằng adapter delay local, không phải production SLO.

## Local MCP

[`backend/src/mcp_server.py`](../../backend/src/mcp_server.py) chạy FastMCP qua stdio. Nó reuse read-only tool registry và bounded analysis engine để:

- đọc overview/columns/distribution/correlation/readiness;
- lập ChartSpec/plan tối đa 12 chart;
- liệt kê forecast capability;
- chạy Preview và promote Official sau workspace membership/context/quality-gate check.

MCP không phải public HTTP route, không cung cấp raw rows và không bỏ qua permission. Mọi tool yêu cầu explicit Profile Run; execution tool còn yêu cầu workspace và actor.

## Source và test

- Graph/node: [`backend/src/agents/`](../../backend/src/agents/).
- Tool/skill: [`backend/src/agents/tools/`](../../backend/src/agents/tools/), [`backend/src/agents/skills/`](../../backend/src/agents/skills/).
- Guardrail/validation: [`guardrails.py`](../../backend/src/services/guardrails.py), [`qa_validation.py`](../../backend/src/services/qa_validation.py).
- Retrieval/trace: [`retrieval.py`](../../backend/src/services/retrieval.py), [`runtime/trace.py`](../../backend/src/agents/runtime/trace.py).
- Test: `tests/test_agents/`, `tests/test_services/test_qa_validation.py`, `tests/test_ai_latency.py`.

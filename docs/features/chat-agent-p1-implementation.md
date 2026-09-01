# Chat Agent P1 implementation report

Date: 2026-08-31

This report records the completed P1 implementation. It separates verified
local checks from release/staging evidence that cannot be produced without an
authorized synthetic workspace.

## Product behavior

### UX-04 — Message actions

Status: DONE

- The shared `ChatMessageActions` component is used by the Chat page, the
  floating widget, and both V1 fallback and V2 structured answers.
- Assistant answers provide Copy, Retry, Regenerate, Ask deeper, Helpful / Not
  helpful, and typed recovery actions. User messages provide Edit & resend.
- Buttons have accessible names, visible focus treatment, and a local pending
  guard so a rapid click cannot create duplicate retry/regeneration requests.
- Copy contains only conclusion, findings, limitations, and next steps; it
  excludes agent-run IDs, context bindings, and internal source objects.
- Feedback is an audit-only `POST /qa/feedback` request bound to
  `agent_run_id` and `message_id`. It never persists raw chat content.

### UX-05 — Explicit, immutable context

Status: DONE

- Both surfaces show the active Dataset, Profile Run, scan type, row scope,
  row count, profile timestamp, and proposal status.
- Changing dataset/Profile Run adds an explicit context-change message.
- Every question and answer stores a context snapshot. V2 provenance is
  server-authored and includes the immutable dataset/run label, scan mode,
  scope, row count, profile timestamp, proposal status, workspace/context
  version, execution binding, and agent run.
- Historical retry, regeneration, deepening, and clarification fetch the
  original Profile Run without silently switching the current UI context.
  An unavailable/unready historical run stops safely.

### UX-06 — Typed recovery and duplicate safety

Status: DONE

- Browser/network, timeout, cancellation, authentication, permission,
  workspace, profile readiness, unavailable profile, insufficient evidence,
  invalid question, context mismatch, tool/provider failure, in-progress, and
  generic server failures have stable public error codes.
- Backend exceptions and SSE frames are redacted to safe code/detail/recovery
  payloads; provider/configuration text and trace data are not delivered.
- Recovery CTAs are code-specific: retry/reconnect, narrow or clarify the
  question, open the original profile, select another context/workspace, or
  refresh the session. Unsupported actions are not rendered.
- Agent-run idempotency keys are scoped by tenant, actor, run type, and a
  stable logical request hash. Completed duplicates replay the validated stored
  answer; in-progress duplicates return `REQUEST_IN_PROGRESS` and never start
  a second graph execution.

## Runtime and API changes

`chat_stream.v1` is retained. Its additive `done` and `error` payloads now
carry `answer_detail`, `answerability`, structured clarification data, typed
error code, and recovery actions. `QARequest`, `QAResponse`, and
`AnswerEnvelopeV2` also carry the additive P1 fields, so existing V1 `answer`
and `sources` consumers remain valid. Frontend OpenAPI types were regenerated.

The existing migration `20260831_0023_chat_agent_idempotency.py` supplies the
partial unique idempotency index used by the duplicate/recovery path; it does
not rewrite historical null keys.

## Architecture changes

```text
Chat page / widget
  -> shared message identity + chat-core reducer
  -> chat_stream.v1 (additive metadata/error fields)
  -> idempotent agent run
       -> completed: validated replay
       -> running: reconnect CTA, no second execution
       -> failed/cancelled: controlled retry
  -> router -> bounded profile + optional external retrieval
  -> deterministic tool/model path -> fail-closed validation
  -> immutable AnswerEnvelopeV2 provenance -> shared renderer
```

- **Retry** reuses the same logical question and context; a reconnect keeps
  the original request ID only for a network/in-progress recovery.
  **Regenerate** creates a distinct answer attempt linked by
  `regeneration_of`. **Ask deeper** is a new, evidence-bound follow-up with
  `answer_detail=deep`.
- Clarification is a typed `answerability` result with server-supplied options.
  Selecting an option creates a linked request that preserves the original
  Profile Run instead of mutating old provenance.
- Parallel branches have an explicit required/optional policy. A required
  profile-evidence failure abstains; optional external knowledge may fail
  without defeating valid run-scoped deterministic evidence.

## Controlled retrieval, budgets, and detail

### LAT-03 — Controlled parallelization

Status: DONE

- Independent profile and external retrieval execute in a bounded executor
  (`qa_parallel_retrieval_concurrency=2`), each with a retrieval timeout. The
  profile branch remains run-scoped; external retrieval is advisory only and
  cannot substantiate a dataset-specific number.

### LAT-04 — Latency budgets by path

Status: DONE

- Settings expose deterministic (5 s), tool (12 s), full-agent (25 s), router
  (3 s), and retrieval (8 s) budgets. Nodes and the stream enforce the active
  deadline, return a typed safe timeout, and record budget category,
  configured budget, timeout/fallback stage, and parallel-branch telemetry.
- The latency record remains PII-safe and contains no prompt, raw row, source
  payload, credential, or model trace content.

### DET-01

Status: DONE

- Both chat surfaces provide conversation-persisted **Nhanh**, **Tiêu chuẩn**,
  and **Chuyên sâu** controls (`quick`, `standard`, `deep` on the wire).
- Quick limits presentation to the conclusion and at most three findings; it
  never removes evidence status, citations, limitations, or approximation.
- Deep increases explanation guidance without granting unbounded tools or any
  source outside the normal evidence-validation boundary. Ask deeper preserves
  the original immutable context.

## Clarification and numeric validation

### ACC-03

Status: DONE

- The QA router returns structured clarifications rather than guessing when a
  column/metric/context is materially ambiguous. Choices are real column names
  or the current versus earlier Profile Run—not invented options.
- A four-case deterministic micro-evaluation has 2 required clarifications and
  2 correctly unclarified cases: precision 2/2, recall 2/2, unnecessary
  clarification 0/2, wrong-context assumption 0/1. This is unit-level
  regression evidence, not an authorized staging acceptance result.

### ACC-04

Status: DONE

- The final validator binds every numeric answer to run-scoped tool evidence,
  source/artifact, semantic metric field, and cited source where supplied.
- It validates localized number formatting, explicit percent/rate conversion,
  labeled fractions (`0.184 (fraction)` may match `18.4%` evidence), safe
  rounding, denominator consistency, temporal/filter scope metadata, and
  approximate/sample disclosure. A bare `0.184` is rejected rather than being
  silently treated as a percent.
- Unsupported units, stale/workspace-mismatched sources, wrong artifacts,
  false denominators, unscoped time/filter claims, and undisclosed sample
  claims fail closed to insufficient evidence.

## Local latency control-flow benchmark

Command run on this workstation, 15 samples per mode with fixed adapters
(tool 12 ms, retrieval 30 ms, model 35 ms):

| Scenario | Before p95 | After p95 | Model calls before → after |
| --- | ---: | ---: | ---: |
| Candidate-key deterministic evidence | 109.592 ms | 26.336 ms | 1 → 0 |
| Deterministic quality evidence | 49.458 ms | 13.943 ms | 1 → 0 |
| Profile fast path | 48.786 ms | 13.838 ms | 1 → 0 |
| Qualitative retrieval | 98.505 ms | 210.846 ms | 1 → 1 |
| Chart planner | 48.422 ms | 9.762 ms | 1 → 0 |

Qualitative retrieval's after-mode p50 improved from 97.228 ms to 69.698 ms,
and retrieval p95 fell from 61.869 ms to 36.656 ms. The after p95 total was
noisy on this local machine because of thread scheduling/model-delay outliers;
it is explicitly not a production or staging latency claim. Use:

```powershell
.\.venv\Scripts\python.exe scripts/benchmark_ai_latency.py --repeats 15 --mode before
.\.venv\Scripts\python.exe scripts/benchmark_ai_latency.py --repeats 15 --mode after
```

## Verification and release block

Local verification covers API/SSE contract and idempotency, graph routing and
parallel retrieval, fast paths, latency telemetry, answer construction, the
semantic numeric validator, shared stream reducer, page/widget lifecycle, and
message-action accessibility:

- `python -m ruff check backend/src tests scripts` — passed.
- Focused P1 backend regression suite — 57 passed.
- `pnpm test` — 79 passed, 1 intentional visual test skipped.
- `pnpm typecheck` and the changed-file ESLint check — passed.
- `pnpm exec playwright test` — 19 passed. The report-markdown fixture now
  supplies the profile-summary request used by the current Command Center
  route, so it exercises the completed-profile view rather than its loading
  state.
- `pnpm build` generated the current optimized `.next` production artifact.
- Evaluation dry-run validated 17 synthetic cases; the offline harness rerun
  completed all 17 with no failed or critical cases. Its release status remains
  `not_evaluated` by design.

The repository-wide pytest command reaches 65 passing tests before the
pre-existing database-backed `tests/test_agents/test_tools.py` worker exceeds
the command runner's 30-second foreground window. The P1-focused tests do not
depend on that fixture and complete normally; this is not represented as a
full-suite pass.

The authenticated staging synthetic evaluation remains blocked by missing
authorized target inputs (`base URL`, workspace ID, Profile Run IDs, and
`P170_EVAL_BEARER_TOKEN`). No offline result or fixed-delay benchmark is
represented as staging quality evidence. The next release gate is to run that
evaluation on this commit and require evidence binding/source/status 100%,
numeric grounding at the approved threshold, zero critical safety failures,
and latency percentiles grouped by deterministic/tool/LLM path.

## P2 follow-up

- Server-side, cross-device conversation persistence with workspace retention
  and deletion controls.
- A freshness-safe semantic answer cache.
- Contextual suggested questions.
- Feedback reason codes promoted into an authorized evaluation corpus.
- Conditional independent verification for high-risk answers only.

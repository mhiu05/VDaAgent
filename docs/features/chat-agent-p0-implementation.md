# Chat Agent P0 implementation report

Date: 2026-08-31

This report records the implemented P0 work and distinguishes verified local
results from staging-only release checks. It does not treat offline evaluation
or fixed-delay benchmarks as production quality or latency results.

## P0 status

### UX-01 — Truthful progress

Status: DONE

- The backend emits versioned `chat_stream.v1` SSE frames with ordered IDs.
- The stream starts with a real `preparing` milestone, then forwards only
  stages actually reached by the QA graph: classification, evidence reading or
  retrieval, tool execution, validation, answer preparation, and completion.
- `token` frames are explicitly marked `delivery: validated_replay`; they do
  not claim provider-token streaming before evidence validation completes.
- Page and widget share the same lifecycle reducer and show actual elapsed
  request time beside the backend-authored stage.
- Both surfaces provide an accessible **Stop** action. Disconnect/cancellation
  sets a cooperative cancellation event, avoids later graph stages where
  possible, stops further frames, and records a cancellable agent run as
  cancelled.

Tests:

- `tests/test_api/test_chat_stream_contract.py`
- `frontend/src/lib/chat-core.test.ts`
- `frontend/src/components/chat-progress.test.tsx`
- page/widget lifecycle tests

### UX-02 — Structured answer presentation

Status: DONE

- `ChatAnswer` presents Conclusion first, then Key findings.
- Evidence and limitations use progressive disclosure; no empty sections are
  rendered.
- An insufficient-evidence answer opens an explicit explanation of what is
  missing and the safe next action.
- Legacy markdown remains the fallback when a V2 envelope is absent.

Tests:

- `frontend/src/components/chat-answer.test.tsx`

### UX-03 — Trust and context signals

Status: DONE

- Per-answer evidence status, approximate marker, sources, agent run, Profile
  Run, scan mode, dataset, workspace, context version, and Official execution
  binding are preserved in immutable V2 provenance.
- The UI renders Verified, Profile-based, Approximate, and Insufficient
  evidence states without treating `no_evidence` as verified.
- Claim-level citations are rendered only from backend-authored mappings and
  open the associated source card. Browser-facing stream sources remove the
  internal workspace binding.

Tests:

- `tests/test_services/test_chat_answer.py`
- `frontend/src/components/chat-answer.test.tsx`

### LAT-01 — User-journey latency telemetry

Status: DONE

- Request-local, PII-safe telemetry records `ttfs_ms`, `ttfe_ms`, `ttfva_ms`,
  `e2e_ms`, existing stage timings, and overlapping stage spans.
- Dimensions include execution path, intent, model, cache status, outcome,
  model/tool/retrieval calls, and token metadata when a provider supplies it.
- It deliberately excludes prompts, rows, source payloads, credentials, and
  other protected content. `e2e_ms` is the critical-path value; stage spans
  must not be summed when parallel work overlaps.

Tests:

- `tests/test_ai_latency.py`

### LAT-02 — Deterministic fast paths

Status: DONE

- An explicit registry handles profile overview, row count, column count,
  highest missingness, and duplicate-row questions through existing bounded,
  read-only tools before an LLM is considered.
- Existing candidate-key and deterministic quality-evidence routes remain
  preserved.
- Every direct answer passes the same fail-closed evidence validator and keeps
  workspace/Profile Run bindings, numeric evidence, approximation, and source
  metadata.
- No broad natural-language answer cache was introduced. The direct tools read
  the current, run-scoped persisted artifacts, avoiding a stale or
  cross-workspace cache surface.

Tests:

- `tests/test_agents/test_fast_paths.py`
- `tests/test_agents/test_graph.py`
- `tests/test_services/test_qa_validation.py`

### ACC-01 — Versioned structured answer contract

Status: DONE

- `QAResponse` retains the V1 `answer` and `sources` fields and adds optional
  `answer_envelope` with `schema_version: "v2"`.
- V2 includes summary, findings, explicit citations, limitations, next steps,
  evidence status, approximation, and immutable provenance.
- Frontend OpenAPI types were regenerated from the backend contract.

Tests:

- `tests/test_services/test_chat_answer.py`
- `tests/test_api/test_chat_stream_contract.py`

### ACC-02 — Release evaluation and hard gates

Status: BLOCKED — authenticated staging inputs are not available in this
workspace.

Completed locally:

- Evaluation fixture dry-run: valid, 17 synthetic cases.
- Offline evaluator: 17/17 cases, all offline harness contract metrics 100%,
  zero critical failures. Report: `evaluations/results/p0-local/`.

This is not a staging score. The canonical gates remain unevaluated until an
authorized synthetic target supplies `--base-url`, `--workspace-id`,
`--profile-run-id`, sampled-run ID where needed, and `P170_EVAL_BEARER_TOKEN`.

## Latency comparison

The following is a repeatable local control-flow benchmark with fixed local
adapters (15 samples; tool 12 ms, model 35 ms). It demonstrates removed model
work, not production network latency.

| Scenario | Before p95 | After p95 | Before model calls | After model calls |
| --- | ---: | ---: | ---: | ---: |
| Profile row-count fast path | 48.484 ms | 13.095 ms | 1 | 0 |
| Candidate-key deterministic evidence | 162.301 ms | 26.374 ms | 1 | 0 |
| Deterministic quality evidence | 60.887 ms | 13.288 ms | 1 | 0 |

Commands:

```powershell
.\.venv\Scripts\python.exe scripts/benchmark_ai_latency.py --repeats 15 --mode before
.\.venv\Scripts\python.exe scripts/benchmark_ai_latency.py --repeats 15 --mode after
```

TTFS, TTFE, TTFVA, and E2E now emit on real requests but have no authentic
staging percentile in this environment. The prior checked-in staging
scorecard is stale and is intentionally not overwritten.

## Architecture changes

```text
Chat page ───────┐
                  ├─ chat-core reducer + lifecycle + history projection
Chat widget ─────┘
                         │
                   chat_stream.v1 SSE
                         │
 Fast-path registry → bounded tool → evidence validator → AnswerEnvelopeV2
                         │
          structured renderer / legacy markdown fallback
```

The request ID is also persisted as a tenant-, actor-, and run-type-scoped
agent-run idempotency key. Migration `20260831_0023` uses a partial unique
index so historical null keys remain unaffected. A duplicate request is not
executed a second time.

## Verification performed

Passed:

- `ruff check backend/src tests scripts/benchmark_ai_latency.py`
- Focused backend suite: `23 passed` (fast paths, evidence validation,
  telemetry, stream contract, V2 envelope, and idempotency)
- `pnpm test`: `73 passed`, `1 skipped`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build` (completed; production build artifact generated)
- Evaluation dry-run and offline harness (above)

Environment failures, not attributed to this P0 change:

- The selected API integration test cannot create its fixture because
  `ProfilingWorker.run_once()` returns false before QA runs.
- The existing Playwright suite completed 18 tests and one unrelated profile
  report test failed because `/profiles/run-ux-test` rendered its backend
  connection error instead of receiving the test route's mocked profile.

## Deferred work

- Run the authenticated staging synthetic evaluation and publish real release
  metrics/gates.
- Add resumable server-side replay for an in-flight duplicate request, rather
  than the current safe no-second-execution response.
- Consider run-scoped deterministic projection caching only after freshness
  invalidation and cross-workspace tests are designed.

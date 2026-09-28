# Agent execution regression verification

## Live Insight authentication reproduction (2026-09-28)

The replacement OpenAI key was verified successfully at 04:08 UTC. Comparing the
active key's suffix from the user's screenshot with the parsed `.env` value exposed
a paste error: the value contained two `sk-proj-` prefixes, with the new key embedded
between eight leading and 51 trailing characters from the old value. The exact
candidate returned HTTP 200 / `completed` from the Responses API before the
`OPENAI_API_KEY` line was corrected. No other environment setting was changed.
`test-results/openai-key-repair-verification.json` records the result without secrets.
The real Insight adapter then passed `pnpm llm:check` for OpenAI (`gpt-4o-mini`).
Gemini still returned `401 unsupported_credentials`; the command exits 1 whenever
either independently checked provider fails, even when the other can serve as fallback.
Web and worker were restarted while no jobs were active to load the corrected value.

The exact original question was then submitted through the chat UI, using project
`P-ALPHA` and data date `2026-09-19`. Job
`6cea68ae-5ab1-47f8-93e3-9f62bf070abc` completed; run
`fb6308b0-2891-405e-b1c5-1be7f01612e1` succeeded on attempt 1 with all nine stages
successful. The persisted Insight identifies `openai` as its provider. All three
claim values match their referenced calculation paths exactly, within the same
organization/run/data date. Reviewer returned `PASS` with no issues, and report
`5658618d-6eaf-4a3e-8138-691ba56a184b` was published at 04:21:05 UTC. Its claims
match the Insight claims and its limitations are retained. The authenticated report
API returned HTTP 200. Refreshing the chat during execution preserved the same run;
the final chat displayed success, nine completed stages and the linked report.
Local evidence: `test-results/insight-openai-live-verification.json` and
`test-results/insight-openai-live-success.png`. Historical failed runs were not changed.

The checks below record the rejected values **before this repair**. A 401 response
alone did not prove that the active key in the user's account was invalid.

Follow-up independent credential checks at 03:51–03:55 UTC used minimal REST requests
to both model-listing and generation endpoints, Node's native HTTPS transport
(independent of `fetch`/SDK), and the real Insight adapters via `pnpm llm:check`.
All methods agreed: OpenAI returned `401 invalid_api_key`; Gemini returned
`401 UNAUTHENTICATED` with `ACCESS_TOKEN_TYPE_UNSUPPORTED`. The Gemini credential
has the `AQ.` auth-key format. That prefix is supported by Google's documented
auth-key scheme; the error alone does **not** establish that this key was revoked.
The adapter sends the documented `x-goog-api-key` header. Resolving a key's
service-account/project binding requires its account configuration; it cannot be
inferred from its prefix or safely repaired by guessing different auth headers.

Both credentials matched the root `.env`, with no duplicate variable definitions,
whitespace, masked placeholders or unexpanded variables. Those checks missed the
concatenated old/new OpenAI value described above. Web and worker launchers both target that
root file. No nested `.env` file was found in this checkout. The live HTTP report
contains no credentials: `test-results/provider-key-live-check.json`.

The normal Data, Comparison, Chart and Analyst stages use deterministic builders;
the Coordinator's approved inventory-question route also does not call an LLM.
Their successful artifacts therefore do not establish provider availability.
Insight invokes the narrative provider. Its safe diagnostics now distinguish
`unsupported_credentials` from `invalid_credentials`, without persisting raw
provider errors. `pnpm llm:check` tests each configured adapter independently, so
a healthy primary cannot conceal a broken fallback.

Additional Google-supported paths were tested with the same model/key: OpenAI
compatibility (`Authorization: Bearer` on `/v1beta/openai/chat/completions`) and
Interactions (`x-goog-api-key` on `/v1beta/interactions`, `store=false`). Both also
returned HTTP 401. No alternative transport was added to production because none
resolved the authentication rejection. Local results:
`test-results/gemini-auth-alternative-check.json`.

The follow-up regression suite passed 56 tests, plus the targeted PostgreSQL wire
authentication case (one passed, eight other cases intentionally excluded). The
wire case verifies both safe authentication reasons survive tool wrapping and
the run/job/message failure remains terminal without publishing a report.

The failed job `622847f2-3e43-4d3e-aca2-4850f64f3ab8` links to run
`0c336333-3391-434d-861c-973d5f504206`. Its exact question is
“Phân tích hiện trạng tồn kho trong phạm vi đang chọn, nêu chỉ số chính, bằng chứng và giới hạn dữ liệu.”,
with project `P-ALPHA` and data date `2026-09-19`.

A read-only replay loaded that run's persisted calculation, bound its three claims,
rebuilt its Insight context, and called the configured Gemini and OpenAI HTTP adapters.
Both returned HTTP 401: Gemini rejected authentication credentials; OpenAI returned
`invalid_api_key`. The environment values matched `.env` and contained no whitespace.
The live provider attempts took approximately 0.9 seconds in total. The 26 evidence
references shown in the UI are not 26 claims or 26 queries. This replay verifies the
current credential failure; the historical aggregate did not retain per-provider details.

Unanimous HTTP 401 failures now propagate `LLM_AUTHENTICATION_FAILED` through the
existing run, task, runtime, job and message error paths. The UI explains that an
administrator must correct the AI connection configuration before another attempt.
Mixed failures retain `ALL_LLM_PROVIDERS_FAILED`; a healthy fallback still succeeds.
Worker logs retain only safe status codes, reasons and durations. No provider response
body or API key is persisted, and no draft is published after a provider failure.

Changing the error classification does not repair rejected credentials or convert a
failed historical run to success. The environment repair above was verified separately.

The same question was also submitted through the local chat UI with the same project
and date. Job `0f4cf9d2-678a-43b7-aaaf-8300a9acb10e` / run
`1191030f-eccd-44f0-9f1c-05b902352e43` reached Insight after five completed stages,
then persisted `LLM_AUTHENTICATION_FAILED` on both the run and job. Its 12 source
and analysis artifacts remained available; there was no insight, draft, review or
published report. The chat showed the authentication recovery guidance.

Verification: 77 provider/worker/UI tests and 9 PostgreSQL wire integration tests
passed; the eight dependency/package typecheck tasks and targeted ESLint checks
passed. Local wire results: `test-results/insight-auth-wire-verification.json`.

The deterministic fixture uses the production `postgres.js` driver over a loopback PostgreSQL wire connection to PGlite. It applies the repository migrations, including the run-version trigger and runtime JSONB constraints. Supabase auth/storage services are replaced by the existing test shims. The socket uses one connection because PGlite has one database session; this does not simulate contention between independent PostgreSQL workers.

No test needs `.env`, production credentials, or a paid provider. The vertical-slice test replaces `fetch` with an in-process API adapter which rejects outbound hosts, and injects a deterministic narrative provider. All run/job IDs are newly created in an isolated test database. Historical runs are not repaired or retried.

## Confirmed failures

- Repository parameters already contain serialized JSON text. The default postgres.js JSONB codec serializes these strings again after server-side type inference. The earlier SQL unwraps covered only some writes. With those unwraps present, the wire fixture reproduced SQLSTATE `23514`, constraint `agent_memory_artifact_refs_check`, when the first completed data tool tried to save its artifact references. Direct PGlite-driver tests did not exercise this codec difference.
- JSONB strings cannot satisfy the run claim predicate `jsonb_typeof(payload)='object'`. Current DDL also rejects them on new run insertion. This explains the queue failure mechanism; the historical IDs supplied in the bug report were not inspected or modified.
- Tool failures discarded their underlying cause. The turn dispatcher also looked for `constraint`, while postgres.js supplies `constraint_name`, and its SQLSTATE pattern excluded letters. Diagnostics now traverse bounded causes and copy only safe type/code/constraint metadata. Public errors retain generic codes.
- Publication returned a promise without awaiting it inside the workflow catch boundary. Asynchronous publication errors could bypass that boundary. They now terminalize the run before propagating to the dispatcher.
- The POST SSE client omitted `/api/v1`. Durable admission now reaches the actual stream endpoint, receives its intentional `406`, and falls back with the same idempotency identity to the accepted JSON endpoint.
- Event-page length was incorrectly treated as job freshness. A later terminal snapshot with fewer events could be discarded. Run SSE snapshots also did not update the displayed run status. Terminal status now wins over stale active reads; pending message/task/review animations stop even if the final detail read is delayed.

## JSONB audit

The driver enforces one shared serialized-JSON contract for both top-level and transaction queries, with no SQL-text rewriting. INSERT, UPDATE and conflict-update paths share that codec. The vertical slice asserts object storage for `runs`, `tasks`, `events`, `artifacts`, `validations`, `messages`, `reports`, `runtime_activities`, `runtime_activity_events` and `agent_execution_events.data`; array storage for `agent_memory.artifact_refs`; and object storage for `conversations.context`. It exercises thread updates and memory upserts as well as report publication and specialist artifact completion.

Incoming SQL unwrap workarounds were removed after this driver fix. Historical message decoding remains intact. Schema constraints, tenant checks, immutable artifacts and fencing are unchanged.

## Reproduce

From the repository root:

```powershell
pnpm test src/backend/worker/src/agent-wire-integration.test.ts
pnpm test src/backend/worker/src/error-diagnostics.test.ts src/backend/worker/src/run-loop.test.ts src/backend/packages/agents/src/team-runtime.test.ts src/backend/packages/agents/src/agent-workflow.test.ts
pnpm test src/frontend/src/features/agent-chat src/frontend/src/features/grok-workspace/components src/frontend/src/server/durable-event-stream.test.ts src/frontend/src/server/runtime-workspace.test.ts src/frontend/src/lib/sse.test.tsx
pnpm exec turbo run typecheck
pnpm lint
```

The wire test follows the actual frontend delivery function, API route handlers, worker loop and dispatchers, repository writes, fake-provider workflow, and browser SSE parser. It checks idempotent admission, queued/running/waiting/terminal transitions, persisted activity, grounded final references, both event endpoints, replay from `Last-Event-ID`, tenant denial, and failure redaction. Separate React and stream tests check received frames updating UI state, reconnect, heartbeat, disconnect, and terminal presentation.

Docker was unavailable during this investigation. The deterministic wire fixture is not a validation of deployed Supabase services, browser/proxy networking or multi-worker load. The root `pnpm typecheck` additionally checks unrelated mock-data tooling; its existing `source-reader.test.ts` implicit-`any[]` errors must be handled separately.

## Recorded results (2026-09-27)

- `test-results/agent-wire-verification.json`: 12 passed, 0 failed (wire vertical slice, runtime API, workspace repository).
- `test-results/agent-ui-verification.json`: 84 passed, 0 failed (React state/presentation, SSE, worker dispatch, team runtime).
- `test-results/agent-publication-verification.json`: the targeted asynchronous publication failure test passed; the other 10 tests in that file were excluded by `-t` in this final targeted run.
- `pnpm exec turbo run typecheck`: all 8 package typecheck tasks passed.
- `pnpm lint`: passed with zero warnings.
- `pnpm typecheck`: package checks passed, but the additional backend tooling check reported TS7034 at `src/backend/scripts/mock-data/lib/source-reader.test.ts:31` and TS7005 at lines 34-35 (`values` is implicitly `any[]`). This existing unrelated file was left unchanged.

The JSON reports are local ignored test artifacts; the tests and commands above are the reproducible source of verification.

## Insight provider failure investigation (2026-09-28)

This investigation is separate from the earlier JSONB / `MAX_ATTEMPTS` work. No historical job/run was executed, repaired or updated. The historical failure's sanitized provider log was not supplied; its exact cause remains unverified.

### Confirmed with deterministic providers

- The incoming working tree already excluded Gemini `thought: true` parts. Its remaining `.find()` still read only the first non-thought text part. A valid structured answer split across two parts was truncated locally, causing `GEMINI_RESPONSE_INVALID`; a failing fallback then produced `ALL_LLM_PROVIDERS_FAILED`. This failed before the fix using 26 synthetic claim IDs. The extractor now concatenates non-thought text within the first candidate only, never across alternative answers. An explicitly unfinished/blocked candidate is rejected.
- Gemini HTTP status and request timeouts were flattened to `GEMINI_REQUEST_FAILED`. A timeout reading the body became `GEMINI_RESPONSE_INVALID`. OpenAI SDK JSON parse errors became `PROVIDER_FAILED`. The installed SDK's `APIConnectionTimeoutError` also inherits `name: 'Error'`, so the old name-only check misclassified it as `PROVIDER_FAILED`; a separate failing-before-fix regression verifies the class-based check. These cases are now classified safely. Existing top-level/public workflow codes remain intact; `provider_failure_codes` uses the existing allowlist, with additional allowlisted `provider_failure_reasons` and numeric `provider_failure_durations_ms` in attempt order. Raw responses, error messages, prompts and credentials are not copied.
- The Gemini adapter still has a 30-second deadline; the installed OpenAI SDK (7.19.0) is still configured for a 30-second timeout and one retry. Insight's tool deadline is 300 seconds and the team deadline is 10 minutes. A 50–56 second total alone therefore proves neither network failure nor prompt failure. A virtual-clock case produces exactly 54 seconds from a 25-second empty Gemini answer followed by a 29-second HTTP 401 fallback; a valid multipart Gemini answer succeeds at 25 seconds without fallback. These delays are injected examples, not reconstructed historical timings.
- No `used queries` counter or literal was present in the current source, so the reported historical `0 / 0` display cannot be attributed to this checkout. Inspector now projects query usage from persisted, same-organization/run `query` artifacts and validated `query_result.input_refs`. It counts each query once, independently of report publication. Missing/redacted/unloaded metadata remains unknown instead of becoming `0 / 0`. The wire fixture yields `1 / 1` even after Insight fails. Evidence-reference counts are not query counts.

### Data and terminal-state checks

`data.evidence` binds claims from the persisted calculation. `insight.compose` checks those claims against the stage input. Branch loading and Insight validation check hashes, tenant, run, scope/date, semantic version and input lineage. The provider receives claim IDs/metric keys plus the bounded runtime context, not permission to calculate new values. Team context is budgeted to roughly 6,000 estimated tokens; the narrative request has a 32,000-byte context guard. The strict summary-key/claim-ID schema and exact claim-set validation remain in force. No token limits, provider models, prompts or retries were relaxed to make the test pass.

Wire tests now exercise split-text success, empty output, wrong schema, invented claims and successful fallback. They compare every pre-Insight artifact before/after execution (including evidence/lineage), check `data.evidence` against persisted references, and validate the published report and Reviewer `PASS`. Failure leaves Insight/task/job/runtime terminal, keeps completed upstream tasks, creates no insight/draft/review/report, cannot be reclaimed, and cannot be overwritten by a subsequent stale `MAX_ATTEMPTS` write. Existing checkpoint rehydration and publication fencing tests remain applicable.

The fixture reproduces 26 runtime evidence references: its Data pack stores 28 refs, and the repository's existing runtime projection keeps the 26 belonging to the artifacts explicitly returned by `data.evidence`. The other two comparison refs remain in the immutable Data pack. The tests check both sets and their relationship, rather than treating the compact runtime projection as the full artifact store.

Provider unit cases additionally exercise the real installed OpenAI parser with injected HTTP responses, Gemini thought-only/blank/malformed/unfinished responses, request/body timeouts, a 30-second deadline followed by successful fallback, oversized context, and cancellation without fallback. All credentials are fake, outbound `fetch` is blocked, and all database execution IDs belong to newly created isolated fixtures.

### Focused reproduction commands

```powershell
pnpm test src/backend/packages/agents/src/insight-provider-regression.test.ts src/backend/packages/agents/src/provider.test.ts src/backend/packages/agents/src/runtime-provider.test.ts src/backend/worker/src/error-diagnostics.test.ts --reporter=default --reporter=json --outputFile=test-results/insight-provider-verification.json
pnpm test src/backend/worker/src/agent-wire-integration.test.ts --reporter=default --reporter=json --outputFile=test-results/insight-wire-verification.json
pnpm test src/frontend/src/features/grok-workspace/components/workspace-inspector-query.test.tsx src/frontend/src/features/grok-workspace/components/agent-workspace-interactions.test.tsx src/frontend/src/features/evidence/query-usage.test.ts --reporter=default --reporter=json --outputFile=test-results/insight-ui-verification.json
pnpm test src/backend/packages/agents/src/draft-workflow.test.ts src/backend/packages/agents/src/agent-workflow.test.ts -t 'rehydrates Coordinator through Draft|preserves branch checkpoints|cannot publish a persisted PASS' --reporter=default --reporter=json --outputFile=test-results/insight-checkpoint-verification.json
pnpm exec turbo run typecheck --filter=@vda/agents --filter=@vda/worker --filter=@vda/web
```

Frontend changes follow the installed Next.js 16.3.5 documentation; the removed frontend `AGENTS.md` was not restored. Parser behavior was checked against the installed SDK and the official [Gemini response contract](https://ai.google.dev/api/generate-content#response-body), [Gemini thinking guidance](https://ai.google.dev/gemini-api/docs/thinking), and [OpenAI structured outputs guidance](https://developers.openai.com/api/docs/guides/structured-outputs).

### Final recorded results

- `insight-provider-verification.json`: 56 passed, 0 failed (provider/parser/fallback/deadline and safe diagnostics).
- `insight-wire-verification.json`: 8 passed, 0 failed (wire/API/worker, success and failure paths, preserved artifacts and terminal projections).
- `insight-ui-verification.json`: 13 passed, 0 failed (persisted query projection, Inspector rendering and Agent identities/icons).
- `insight-checkpoint-verification.json`: 4 selected tests passed, 10 excluded by the name filter; no failures (rehydration, failure preservation, cancellation and stale-owner publication guards).
- Filtered Turbo typecheck: 8/8 tasks successful, including agents, worker, web and their dependencies. The final pass includes the new regression tests.

Total: 81 focused tests passed. No full suite, ESLint, Prettier, build, production provider call or commit was run.

Limits: fake-provider results do not verify production credentials, provider/model availability, actual historical responses, deployed browser assets, Supabase networking or concurrent multi-worker load. A future authorized run's sanitized per-provider codes/reasons/durations can distinguish those cases without retrieving its prompt or response body.

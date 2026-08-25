# VDaAgent Performance Optimization Implementation

Tracks implementation of `docs/performance-optimization-plan.md`. Role:
READ PLAN → VERIFY CODE → IMPLEMENT → TEST → BENCHMARK → DOCUMENT. Evidence-first
invariants (workspace/capability isolation, Preview/Official evidence,
`result_hash`/provenance, async profiling jobs) are preserved throughout.

## Task status changelog

```
PERF-001 ✅ IMPLEMENTED (instrumentation) — live-verified, <2% overhead NOT MEASURED
PERF-002 ⛔ BLOCKED — no representative staging workspace to seed/measure
PERF-003 ⛔ BLOCKED — baseline/EXPLAIN needs staging data & pg_stat_statements
PERF-101 🟡 PARTIAL — frontend query-key unification pre-existing; backend catalog NOT STARTED
PERF-102 🟡 PARTIAL — job status projection done; dataset/report cursor pagination NOT STARTED
PERF-103 ✅ IMPLEMENTED — profile-detail redundant PII + 3 pending-count queries removed
PERF-104 ⏳ NOT STARTED
PERF-105 ⏳ NOT STARTED
PERF-106 ⛔ BLOCKED on PERF-003 GO (index EXPLAIN evidence)
PERF-107 ⏳ NOT STARTED
PERF-201..402 ⏳ NOT STARTED
```

Legend: ✅ implemented+tested · 🟡 partial · ⏳ not started · ⛔ blocked.

## Summary

Phase 0 instrumentation (PERF-001) landed previously and is live-verified. This
batch implements the two highest-confidence, lowest-risk Phase 1 backend wins
that do **not** depend on the blocked staging baseline:

- **PERF-103** — profile detail (`GET /profile/{runId}`) stopped issuing four
  redundant DB queries (one `confirmed_pii_columns` + three `pending_count`
  `COUNT()` queries) whose answers are already contained in the proposal rows
  loaded by `get_proposals`. Now derived in memory. This is the CONFIRMED
  heaviest DB endpoint in the plan.
- **PERF-102 (partial)** — `get_profile_job` now projects only the ~10 queue
  columns `ProfileJobResponse` needs, instead of `SELECT profile_runs.*` which
  pulled heavy JSON/text (`correlation_matrix`, `terminal_result`, `answer`,
  `answer_sources`, `job_payload`, …) on every status poll.

No API response shapes changed. No migrations. Authorization, workspace scoping
and PII fail-closed masking are unchanged and covered by existing + new tests.

## Baseline

NOT MEASURED. No representative staging workspace or `pg_stat_statements` access
in this environment (see PERF-002/003, BLOCKED). Query-count improvements below
are exact static counts confirmed by code + the new query-count regression
tests, not wall-clock benchmarks.

## Implemented Tasks

### PERF-103 — Profile detail query consolidation
- **Status:** IMPLEMENTED (PLAN MATCHES CODE — the CONFIRMED duplicate
  proposal-count + separate PII query both existed as described).
- **Files changed:**
  - `backend/src/services/repository.py` — added `_PII_MASK_STATUSES` frozenset
    and `_pii_mask_columns()` helper; `full_profile()` now loads proposals once,
    derives the PII mask set and `pending_proposals` from those rows, and returns
    a new `pending_proposals` key. `confirmed_pii_columns()` reuses the shared
    status set (behavior identical).
  - `backend/src/api/routes.py` — `_build_profile_response` reads
    `profile["pending_proposals"]` instead of calling `repo.pending_count(run_id)`.
  - `tests/test_services/test_security.py` — new
    `test_full_profile_derives_pending_count_without_extra_queries` (query-count
    ≤8 regression + pending-count equivalence).
- **What changed:** removed 4 redundant queries per profile-detail assembly:
  `confirmed_pii_columns` (1) and `pending_count` (3 `COUNT()` across proposal
  tables). Both are now computed from the proposal rows already fetched.
- **Tests:** `tests/test_services/test_security.py` (21 passed incl. PII mask +
  new regression); `test_profile_returns_draft_pending_review`,
  `test_confirm_applies_decisions_and_clears_pending`,
  `test_request_test_resumes_and_reinterrupts_at_review` (pending_proposals
  parity across the full HITL lifecycle) all pass on a clean test DB. ruff clean.
- **Benchmark:** query count for `full_profile` internals: **before ~12, after 8**
  (run + dataset + column_stats + 3 proposals + tests + drift). Wall-clock NOT
  MEASURED. `_build_profile_response` drops one further `pending_count` call.
- **Security impact:** PII masking is byte-identical — same fail-closed status set
  (`confirmed/edited/auto_confirmed/pending`), now centralized in
  `_PII_MASK_STATUSES` so the standalone query and in-memory derivation cannot
  diverge. Workspace scoping unchanged (`get_profile_run(..., workspace_id=)`).
- **Notes:** did NOT collapse the 3 proposal reads into a `UNION ALL` — the plan
  lists that as optional/benchmark-gated and it adds mapping complexity without a
  measured win. Fixed-count child queries retained per plan §PERF-103 step 4.

### PERF-102 (partial) — Lean job-status projection
- **Status:** IMPLEMENTED for the job/status path; dataset/report/activity cursor
  pagination and summary DTOs NOT STARTED (depend on PERF-106 indexes → PERF-003).
- **Files changed:**
  - `backend/src/services/repository.py` — `get_profile_job()` selects only
    `id, dataset_id, created_at, job_status, job_stage, job_attempt_count,
    job_started_at, job_finished_at, job_error_code, job_error_message`.
  - `tests/test_services/test_profile_jobs.py` — new
    `test_get_profile_job_projects_only_queue_columns` asserting heavy columns and
    queue secrets (`job_claim_token`, `job_payload`) are absent.
- **What changed:** `GET /profiling-jobs/{id}` no longer reads heavy JSON/text
  columns. Response shape unchanged (`_build_profile_job_response` uses exactly
  the projected fields; it is the only caller).
- **Tests:** `tests/test_services/test_profile_jobs.py` — 9 passed incl. new
  projection regression. ruff clean.
- **Benchmark:** row width reduced (heavy TOAST columns no longer fetched on every
  poll). Exact payload bytes NOT MEASURED.
- **Security impact:** workspace ownership predicate retained; internal queue
  secrets (`job_claim_token`, `job_worker_id`, `job_payload`) are no longer even
  selected, tightening the surface.
- **Notes:** projection is safe because the sole caller maps a fixed field set.

## Database Migrations

None in this batch. PERF-106 index migrations remain BLOCKED on PERF-003 GO
(need EXPLAIN evidence on representative data before adding indexes).

## API Contract Changes

None. `ProfileResponse` and `ProfileJobResponse` shapes are unchanged;
`full_profile()` gained an additive internal `pending_proposals` dict key
(consumed server-side only).

## Frontend Coordination Changes

None required this batch. Pre-existing PERF-101 frontend query-key unification
(chat widget / profile-run-picker / charts) is already in the working tree and
was left untouched.

## Benchmark Comparison

| Flow | Metric | Before | After | Change |
|---|---|---:|---:|---:|
| `GET /profile/{runId}` | wall-clock p95 | NOT MEASURED | NOT MEASURED | — |
| `GET /profiling-jobs/{id}` | payload bytes | NOT MEASURED | NOT MEASURED | — |

## Query Count Comparison

| Endpoint | Before | After |
|---|---:|---:|
| `full_profile()` internals | ~12 | 8 |
| `_build_profile_response` extra `pending_count` | 1 (×3 COUNT) | 0 |
| `get_profile_job` columns selected | all (`profile_runs.*`) | 10 projected |

## Payload Comparison

| Endpoint | Before | After |
|---|---:|---:|
| `GET /profiling-jobs/{id}` | full row incl. heavy JSON | queue fields only (NOT MEASURED in bytes) |

## Remaining Tasks

PERF-101 (backend catalog endpoint + cursor), PERF-102 (dataset/report/activity
cursor pagination + summary DTOs), PERF-104, PERF-105, PERF-107, PERF-201..402.

## Blocked Tasks

- **PERF-002 / PERF-003** — no representative staging workspace, no
  `pg_stat_statements`/EXPLAIN-safe data here. Baseline numbers and GO/NO-GO
  gates cannot be produced without fabricating data.
- **PERF-106** — index creation is explicitly gated on PERF-003 EXPLAIN evidence;
  adding indexes blind risks redundant/duplicate indexes (a named failure mode).
- Any task whose acceptance criteria require before/after wall-clock or payload
  byte measurements is blocked on the above.

## Risks / Follow-up

- The ~12→8 count for `full_profile` is a static/regression-test count; confirm
  with runtime telemetry once a staging baseline exists.
- PERF-102 completion (cursor pagination) should ship after PERF-106 catalog
  indexes to avoid seq-scan/sort on large workspaces.

## Final Validation

- Backend focused tests: `test_security.py` (21), `test_profile_jobs.py` (9),
  profile HITL lifecycle route tests — all pass on isolated Docker Postgres.
- ruff: clean on all changed files.
- Pre-existing failures `test_drift_detects_salary_shift` and
  `test_drift_requires_completed_profile_runs` are ENVIRONMENTAL (fail identically
  on the untouched baseline — local harness does not reliably drive both runs to
  `completed`); not caused by this batch.
- Full pytest suite / ruff on `backend tests` / frontend typecheck+lint+test+build:
  NOT RUN this batch (scoped to changed paths); to run at Phase 1 checkpoint.

# MVP validation

This document defines the MVP validation gate. A command that was not run, or
that cannot run because its local dependency is unavailable, is **unverified**;
it is not a passing result. Run commands from the repository root and inspect a
failure before proceeding.

## Normal validation sequence

```sh
git status --short
git diff --check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm db:start
pnpm exec supabase --workdir src/backend db diff
pnpm test:db
pnpm check:security
pnpm check:docs
pnpm test:e2e
```

When a contract schema changes, also run `pnpm contracts:export` and review the
generated contract schema files before the relevant typecheck and tests. The
final `db diff` command is a drift check; do not add `-f` during this gate
because that would create a migration instead of reporting remaining drift.

`pnpm test` runs the unit and integration suites configured with PGlite and
test doubles where appropriate. `pnpm test:db` runs the Supabase database test
suite against the local stack, including RLS coverage. `pnpm test:e2e` starts
and resets a local Supabase stack through its Playwright server command. None of
these commands may be configured with hosted production credentials.

`pnpm db:reset` is acceptable only when the caller deliberately wants to reset
a disposable local stack. It is not part of the normal non-destructive release
gate and must never target production.

## Workflow-version E2E coverage

The default E2E invocation keeps `AGENT_WORKFLOW_ENABLED=false` and exercises
legacy regression behavior. Run the opt-in workflow coverage separately:

```sh
# POSIX shell
E2E_AGENT_WORKFLOW=true pnpm test:e2e

# PowerShell
$env:E2E_AGENT_WORKFLOW = 'true'; pnpm test:e2e
```

The opt-in suite verifies the `agent-v1` workflow version, persisted specialized
agent identities, owner/analyst workflow-status access, private checkpoints,
and an authorized targeted follow-up. The legacy UI regression test is skipped
in that opt-in mode by design; both invocations are required when validating a
rollout.

## MVP coverage map

| Risk or acceptance area | Primary evidence |
| --- | --- |
| Metric semantics, as-of selection, null/abstain, and quality limits | `src/backend/tests/unit/semantic.test.ts` |
| Chart provenance and report/chart agreement | `src/backend/tests/unit/chart-builder.test.ts`, `src/backend/tests/unit/pipeline.test.ts` |
| Queue, retry, cancellation, lease fencing, and legacy publication | `src/backend/tests/unit/postgres-pipeline.test.ts`, `src/backend/tests/unit/pipeline.test.ts` |
| Coordinator/Data packs and recovery | `src/backend/packages/agents/src/coordinator.test.ts`, `data-agent.test.ts`, `workflow.test.ts` |
| Concurrent Comparison, Chart, and Analyst branches | `src/backend/packages/agents/src/branch-workflow.test.ts` |
| Insight, immutable drafts, review, and publication gating | `draft-workflow.test.ts`, `reviewer-agent.test.ts`, `agent-workflow.test.ts` |
| Private draft/review artifacts and lineage access | `artifact-visibility.test.ts`, repository tests, and `src/backend/supabase/tests/tenant_rls.test.sql` |
| Agent Chat routing, typed tools, and follow-up safety | `chat.test.ts`, `tools.test.ts`, and `src/frontend/src/components/agent-chat/agent-chat.test.tsx` |
| Contracts and schema strictness | `src/backend/tests/unit/agent-workflow-contracts.test.ts`, `pnpm contracts:export` |
| RLS, grants, client/server secret boundary, and schema parity | `pnpm test:db`, `pnpm check:security` |
| Local API/UI, import, scheduler, export, authorization, and workflow opt-in | `src/backend/tests/e2e/mvp.spec.ts` through both E2E modes |

The MVP release gate requires the relevant rows above and the complete command
sequence to pass for the changed scope. Record skipped commands, local-service
failures, and any rollout observations explicitly rather than treating them as
success.

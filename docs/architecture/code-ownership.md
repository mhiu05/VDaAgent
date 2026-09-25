# Code ownership after the structural refactor

This guide points to the implementation owners. [The refactor plan](../refactor-code-plan.md) records the migration rationale and validation gates.

| Concern | Owner |
| --- | --- |
| Wire contracts and JSON Schema export | [contracts leaf modules](../../src/backend/packages/contracts/src/index.ts), [schema exporter](../../src/backend/packages/contracts/src/export.ts) |
| As-of selection, metrics, peer comparison, insights, decision brief | [semantic modules](../../src/backend/packages/semantic/src/index.ts) |
| Import parsing, artifact integrity, claim binding, report and workflow validation | [domain modules](../../src/backend/packages/domain/src/index.ts) |
| Tenant authorization, persistence, leases, reports and publication | [Repository facade](../../src/backend/packages/db/src/repository.ts) and its `authorization/`, `repositories/`, `workflow/`, `transactions/`, `mapping/`, and `storage/` modules |
| Legacy run workflow | [legacy executor](../../src/backend/packages/agents/src/legacy-workflow/workflow.ts) |
| Versioned agent workflow | [agent-v1 executor](../../src/backend/packages/agents/src/analysis-v1/workflow.ts), with stages, checkpoint helpers and specialist agents nearby |
| Default conversation turn | [legacy chat orchestrator](../../src/backend/packages/agents/src/chat/legacy/orchestrator.ts) |
| Feature-gated Agent Runtime | [runtime](../../src/backend/packages/agents/src/runtime/runtime.ts), [capability registry](../../src/backend/packages/agents/src/runtime/capabilities/registry.ts), and [provider factory](../../src/backend/packages/agents/src/runtime/providers/factory.ts) |
| Worker process | [main](../../src/backend/worker/src/main.ts), [run loop](../../src/backend/worker/src/run-loop.ts), [dispatcher](../../src/backend/worker/src/workflow-dispatcher.ts), [scheduler](../../src/backend/worker/src/scheduler.ts), and [signal lifecycle](../../src/backend/worker/src/lifecycle.ts) |
| Same-origin API | [router](../../src/frontend/src/server/api/router.ts), resource routes under `server/api/routes/`, and the [catch-all route](../../src/frontend/src/app/api/v1/%5B...path%5D/route.ts) |
| Browser workspace | [Workspace composition](../../src/frontend/src/features/workspace/workspace.tsx), feature hooks and APIs under `features/`, and [common HTTP transport](../../src/frontend/src/lib/http/api-client.ts) |
| Synthetic warehouse import | [CLI](../../scripts/mock-data/import-mock-data.ts), with source, environment, retry and writer modules under `scripts/mock-data/lib/` |

## Dependency and authority boundaries

- Browser features call the same-origin BFF through feature APIs and the common HTTP transport. Server packages and credentials stay outside browser imports.
- Contracts define wire formats. Semantic and domain code own deterministic numeric results, evidence, validation and lineage. Providers may select bounded identifiers but cannot author those values.
- The public `Repository` facade keeps tenant and role checks, PostgreSQL RLS and transaction boundaries. `createRun` pins snapshots atomically. `publishReviewedDraft` remains one fenced transaction; generic artifact storage cannot publish an agent-v1 report.
- Worker dispatch reads the run's pinned `workflow_version`. Signal handling stops after the current iteration, lease renewal remains on the claimed run, and repository closure stays in the process `finally` block.
- The legacy workflow, agent-v1 workflow, default chat and Agent Runtime are distinct execution paths. Their package root exports remain explicit compatibility symbols; new internal imports should use the owning module.

## Validation

Run the focused package test and typecheck when moving a boundary. The full repository gate is `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:security`, `pnpm check:docs`, `pnpm build`, and `pnpm test:e2e`. `pnpm test:db` needs a working local Supabase/PostgreSQL environment. Existing deleted handoff documents are tracked separately from refactor regressions.

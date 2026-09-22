# MVP requirement traceability

This is a traceability map for the VDaAgent MVP. It identifies the implementation
boundary and the validation evidence that must be reviewed; it is not a claim
that every listed command has already passed. Current code and tests take
precedence over planning documents when they differ.

| MVP requirement | Implementation boundary | Validation evidence |
| --- | --- | --- |
| Supabase-only local runtime | Configuration in `.env.example`, `@vda/config`, Supabase schemas/migrations, and the web BFF | Local setup procedure; `pnpm typecheck`, `pnpm test:db`, and E2E on the local stack |
| Authentication, organization membership, and roles | Supabase Auth context, `SqlRepository.authorize`, RLS policies | Repository tests, `tenant_rls.test.sql`, E2E owner/analyst/viewer checks |
| No browser exposure of server credentials | `NEXT_PUBLIC_*` configuration boundary and server/worker-only packages | `pnpm check:security` |
| Frozen snapshots, authorized scope, and as-of semantics | Analysis request contracts, repository snapshot pinning, `@vda/semantic` | `semantic.test.ts`, pipeline tests, cross-tenant checks |
| Deterministic metrics, null/abstain behavior, and provisional formulas | `@vda/semantic` metric registry and typed contracts | Semantic oracle tests and contract tests |
| Artifact immutability, hash/lineage, and evidence grounding | Artifacts, validations, source/snapshot/input references, and integrity validation | Pipeline, repository, visibility, and RLS tests |
| Durable queue, worker lease, retry, cancellation, and stale-worker fencing | `runs`/tasks/events repository methods and `@vda/worker` | Postgres pipeline and workflow recovery/cancellation tests |
| Independent analytic branches share one canonical data pack | Coordinator/Data/Comparison/Chart/Analyst typed workflow boundaries | Coordinator, data-agent, workflow, and branch-workflow tests |
| Report drafts are immutable and publication is gated | Keyed artifact revisions, Insight/Report/Reviewer workflow, deterministic publication validation | Draft-workflow, reviewer-agent, agent-workflow, and contract tests |
| No final report before an exact passing review | Review result is bound to the draft revision/hash before report publication | Agent-workflow publication-gate tests and database lineage checks |
| Agent Chat is reference-only, bounded, and authorized | Conversations/messages, typed decisions/tools, BFF authorization, and client schema parsing | Chat/tools/repository tests and Agent Chat component tests |
| Specialized agent messages and guarded `@agent` follow-ups | `sender_agent`, stage messages, authorized artifact hydration, workflow-status API, and Agent Chat UI | Agent workflow, artifact visibility, chat/tools, component, and opt-in E2E tests |
| Private drafts and reviews remain limited to owner/analyst | Artifact and lineage RLS policies in workflow persistence schema | pgTAP RLS, artifact-visibility tests, and `pnpm check:security` |
| Scheduled and interactive execution use compatible durable workflow behavior | Scheduler definitions/occurrences and worker dispatch by persisted workflow version | Pipeline tests and E2E scheduler coverage |
| Legacy runs remain readable during opt-in rollout | Persisted `workflow_version`, default-off `AGENT_WORKFLOW_ENABLED`, dual rendering/dispatch | Default E2E legacy mode plus opt-in `E2E_AGENT_WORKFLOW=true` mode |
| Reports and exports remain private and authorization-checked | Reports/export ledger, private storage, and signed BFF download path | Repository/pipeline tests and E2E export authorization |
| Documentation, schema, and security handoff remains reviewable | Local setup, validation gate, implementation plan, contract exports, declarative schema/migrations | `pnpm check:docs`, `pnpm contracts:export`, `pnpm check:security`, `pnpm exec supabase --workdir src/backend db diff` |

## MVP scope limits

The current MVP uses synthetic/provisional inventory data and the
`mvp-inventory-*` semantic contracts. It does not authorize causal explanations,
portfolio-wide comparisons, arbitrary SQL, invented metrics or evidence, remote
deployment, or external report delivery. Adding one of those capabilities
requires a versioned product/semantic contract, deterministic implementation,
lineage and authorization controls, and corresponding validation—not only a
prompt or UI change.

## Rollout and rollback evidence

The implementation plan defines a default-off agent-workflow rollout. Before
opting in new runs, review the migration/RLS state and run the focused workflow
tests plus both E2E modes documented in `docs/23_Testing/MVP_Validation.md`.
If a rollout issue occurs, disable `AGENT_WORKFLOW_ENABLED` for new runs; do not
discard existing artifacts, reports, or legacy-run compatibility data. Record
the failed gate and observed behavior before attempting another opt-in.

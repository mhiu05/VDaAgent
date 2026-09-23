# MVP Requirement Traceability

This document maps MVP and P0 Agent Runtime requirements to the existing
implementation boundaries and validation evidence. It records behavior rather
than authorizing a future expansion of scope.

| Requirement | Implementation boundary | Validation evidence |
| --- | --- | --- |
| Tenant-scoped, conversation-scoped context | BFF route checks and server-side runtime context builder | runtime-context, API, repository, and security tests |
| No disclosure from stale or foreign references | Organization-scoped readers, public-artifact filtering, root-to-child lineage resolution | cross-tenant and stale-child runtime-context tests |
| Closed execution surface | Nine-capability registry with strict input/output parsing | capability-registry and planner tests |
| At most one queued analysis run | Whole-plan preflight, create-only plan rule, runtime counters, repository idempotency | runtime and capability-registry mutation tests |
| Bounded provider work | Configured provider attempts, provider timeout, 45-second capped turn deadline, bounded projections | runtime-limits, runtime-provider, and runtime tests |
| Grounded analytical output | Canonical observations, ID-only response selection, deterministic renderer | answer-composer and capability-registry tests |
| Legacy compatibility | `GROK_RUNTIME_ENABLED` server seam and unchanged legacy orchestrator | legacy Agent Chat, API, and frontend tests |
| Optional xAI, SSE, and dashboard features | Explicit configuration flags and JSON/polling correctness path | configuration, stream, and frontend tests |
| Metadata-only operational visibility | Runtime provider/activity telemetry contracts | activity and runtime-provider tests |
| No persistence migration for P0 | Existing messages, run, artifact, and idempotency persistence | repository and integration tests |

## MVP release gate

The MVP handoff requires successful type checking, linting, repository tests,
security checks, and documentation checks. Rollback is operational: disable
`GROK_RUNTIME_ENABLED`; no schema or data rollback is required.

The deferred MVP work remains intentionally excluded: provider-authored
analytical prose, autonomous loops, parallel tools, arbitrary SQL or web
search, persisted plans or prompts, mandatory streaming, and xAI as a default
provider.

# MVP requirement traceability

| MVP requirement | Implementation / validation |
| --- | --- |
| Tenant isolation | PostgreSQL RLS policies, repository membership checks, pgTAP and PGlite tests |
| Queue and worker lease | `runs` queue, `FOR UPDATE SKIP LOCKED`, fencing checks, pipeline tests |
| CSV source lineage | `source-imports` private bucket, import manifest/hash, repository tests |
| Report export | `report-exports` private bucket, signed BFF download grant, export ledger |
| Supabase authentication | Supabase SSR `auth.getUser()`, password login route and local Auth E2E |
| Database runtime | PostgreSQL-only driver with TLS and no SQLite fallback |
| Authoritative metric semantics | executable metric registry plus semantic oracle tests |
| Units and null/zero separation | typed metric/currency schemas, delta abstention fields, frontend formatter tests |
| Historical as-of behavior | latest-at-or-before selection and target-date trend tests |
| Chart/report agreement | immutable calculation bindings, chart provenance validation, report equality checks |
| Claim grounding | deterministic candidates, exact evidence-path resolution, constrained provider tests |
| End-to-end lineage | immutable input/snapshot/source references and full report lineage validation |
| Agent Chat persistence and safety | workspace-shared `conversations`/`messages`, typed reference-only parts, keyset paging, idempotent turns, server-owned tool context and `chat.test.ts` / repository coverage |
| Agent Chat access control | owner/analyst turn and cancellation checks, viewer denial, cross-tenant repository tests, pgTAP direct-write denial and `check-security.ts` schema/grant inspection |
| Agent Chat results and progress | existing queue/DAG/artifacts/report renderers, persisted assistant lifecycle states and active-run polling in `agent-chat` components |

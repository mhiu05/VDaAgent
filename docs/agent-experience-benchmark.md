# Agent experience projection benchmark

Run `pnpm exec tsx scripts/maintenance/benchmark-agent-experience.ts` from the repository root. The script creates and closes an isolated PGlite database; it never reads or resets a shared database. Its fixture has 1,000 mixed-recipient historical messages, two accepted active runs, and two delegated Data calls. Timings below are from a local run on 2026-09-29 and are diagnostic measurements, not a production latency target.

| Read | Endpoint elapsed | Main `EXPLAIN ANALYZE` time | Relevant scan rows |
| --- | ---: | ---: | --- |
| Latest Data feed, 30 items | 61.38 ms | 5.00 ms | 117 message rows through `messages_conversation_page` |
| Deep focus, 15 newer items | 43.98 ms | 1.15 ms for newer page | 60 message rows through `messages_conversation_page`; exact focus found one row |
| Eight-agent summary, two active runs | 44.76 ms | 0.52 ms preview / 0.72 ms totals | Two turn jobs and two accepted runtime calls |
| Accepted Data work | 15.47 ms | 0.60 ms | Two accepted runtime calls |

The initial combined-source query scanned all 1,004 conversation messages for the latest page and 1,000 for the newer half of deep focus. Pushing the keyset bound and page limit into each source branch changed those scans to 117 and 60 rows respectively. Existing conversation/time indexes were used; no SQL migration was needed for this fixture. Measure again against production-scale distributions before assigning a service-level target.

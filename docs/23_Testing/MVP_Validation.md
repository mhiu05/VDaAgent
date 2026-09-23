# MVP Validation Evidence

This MVP validation guide covers the deterministic data plane, Agent Chat
compatibility path, and the opt-in P0 runtime. It does not require SSE, the
optional dashboard layout, xAI, a database migration, or a new HTTP endpoint.

## Required automated checks

```text
pnpm contracts:export
pnpm typecheck
pnpm lint
pnpm test
pnpm check:security
pnpm check:docs
```

The full test command covers contracts, repository authorization, workflow
publication, legacy Agent Chat, runtime planning/composition, BFF API, and
frontend workspace/chat behavior. Focused runtime tests additionally cover
these P0 boundaries:

- workspace/top-level request coherence and tenant-scoped lineage resolution;
- granular stale child removal without widening or merging run context;
- the closed nine-capability registry, duplicate registration, role/mode
  checks, and one queued analysis run;
- whole-plan preflight, attempt/call/deadline budgets, sequential execution,
  replay behavior, and safe partial results;
- canonical observations, ID-only composition, deterministic rendering, and
  rejection of forged observation, reference, and action IDs;
- legacy flag-off behavior, explicit agent targets, JSON polling, and
  allowlisted workspace actions.

## Manual MVP smoke path

1. Start with `GROK_RUNTIME_ENABLED=false` and confirm the existing Agent Chat
   response remains available.
2. Enable the runtime with Gemini/OpenAI credentials and submit a grounded
   read against a published run or report.
3. Submit one supported analysis request and confirm a single queued run is
   returned; use existing polling to observe terminal status.
4. Retry the same client turn identifier and confirm it returns the committed
   turn/run rather than creating a duplicate.
5. Select a stale child reference and confirm the valid parent remains usable
   while the response is unavailable or partial as appropriate.
6. Disable the runtime flag and confirm the legacy route still handles the
   next turn.

## MVP acceptance boundary

All analytical content rendered by the flagged runtime is reconstructed from
authorized canonical observations. Providers may select supplied IDs only;
they cannot provide facts, numbers, references, URLs, or workspace actions.
Validated public artifacts remain the only artifact content available to the
runtime.

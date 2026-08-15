# ADR: Agent runtime v2 foundation

## Status

Accepted for the additive trace rollout.

## Decision

1. PostgreSQL domain tables (`agent_runs`, steps, attempts, invocations,
   evidence and trace events) are the source of truth for agent lifecycle.
   A LangGraph checkpoint remains orchestration state only.
2. Profiling stays a fixed LangGraph workflow. The planner is disabled by
   default and is not an entry point for profiling, SQL, code, shell commands
   or dynamic tools.
3. All persisted trace payloads are redacted and bounded. They retain a reason
   code, a short reason summary, hashes, timing, version IDs and aggregate
   evidence coordinates; they never retain raw prompt/messages, scratchpad,
   raw row, secret, source path or PII sample values.
4. Trace starts in `shadow` mode. It observes the compatibility workflow but
   does not change its result. `required` mode fails closed if trace persistence
   fails. Planner and verifier remain disabled until their own deterministic
   evaluation gates pass.
5. A profile with an error transitions to `failed`; `finalize` cannot project
   it as `completed` through an unconditional graph edge.

## Consequences

- The same `agent_run_id` can answer what executed, which model/tool version
  was used, which bounded evidence was produced and what failed/retried.
- Generic trace APIs require Analyst/Admin capability and are tenant-scoped.
  Viewer provenance requires a separate, narrower published-report projection.
- This schema is expand-only. Rollback uses feature flags and preserves run
  provenance; it does not drop runtime tables.

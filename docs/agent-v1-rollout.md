# Agent-v1 rollout and recovery

This runbook accompanies [the migration plan](plan.md). New `AnalysisRun` rows use
`agent-v1`. Existing `legacy-v1` rows, including payloads without a version,
retain their original identity and report data.

## Release A: writer cutover and drain

1. Record a cutover timestamp and a read-only inventory by organization,
   effective workflow version, run status, lease expiry, attempts, linked jobs,
   active messages, report count, and artifact hashes. Keep the inventory in a
   restricted deployment record.
2. Pause API mutation admission and scheduler ticks. Replace every web and
   worker instance; an old worker can still create scheduled legacy runs.
3. Apply migrations 006, 007, 008, then
   `20260925082316_guard_run_workflow_version.sql`. Confirm the trigger exists
   before reopening traffic. The schema is required even when durable job
   admission is disabled because agent task updates project into its tables.
4. Verify web and worker startup readiness. Canary direct analysis, a Runtime
   JSON turn, a supported durable job, and a scheduled occurrence. Each newly
   inserted run must store `workflow_version: agent-v1`. A report may appear
   only after Reviewer PASS and publication.
5. Drain the pre-cutover legacy cohort with the transition worker. Do not retry
   failed legacy runs or change their version. Wait for zero queued/running
   legacy runs and zero live legacy leases before release B.

At worker startup, active rows with an unrecognized workflow version are
counted in `unknown_active_workflow_version` log events. The claim query skips
those rows so a bad historical payload cannot hold the queue head. Investigate
and resolve each such row in the restricted deployment inventory; the worker
does not relabel or execute it. The inventory also counts JSON null, invalid
types, and malformed active payloads. A valid historical row with the version
key absent remains readable as `legacy-v1` and can drain through the transition
worker.

The administrative retirement script accepts explicit organization and run
IDs. Dry run is the default. Use an environment with `SUPABASE_DB_URL` set and
record its JSON output privately:

```sh
pnpm exec tsx src/backend/scripts/retire-legacy-runs.ts \
  --org=<org-id> --run=<run-id> --cutover-at=<ISO-timestamp>
```

After reviewing the preview and confirming the selected cohort and deadline,
repeat with `--apply`. The script rejects a live lease, a terminal run, a new
run, or a run created after the supplied cutover. Apply fences the run, marks
active tasks cancelled, appends a retirement event, and finalizes active
initiating messages. It leaves snapshots, artifacts, hashes, reports, and
successful tasks untouched. There is no public retirement endpoint.

For a non-durable HTTP turn that stopped before a run or job was linked, first
stop every web process that could still own the request and choose an
`--older-than` timestamp beyond the request timeout and grace period. Preview
one conversation/client turn identity:

```sh
pnpm exec tsx src/backend/scripts/reconcile-stalled-turns.ts \
  --org=<org-id> --conversation=<conversation-id> \
  --client-turn=<client-turn-id> --older-than=<ISO-timestamp>
```

After checking `reason: null` and confirming the HTTP owner stopped, repeat
with `--apply --owner-stopped`. The transaction rechecks the identity, run/job
link, age, and message status under lock. It marks only the unlinked placeholder
failed with `TURN_INTERRUPTED`; it never replays the request. A new attempt
needs a new client turn ID. Keep the JSON output in the restricted recovery log.

An already terminal legacy run can still have a stuck initiating message or
active task projection from an older binary. After its owner has stopped,
preview the exact run and an age cutoff:

```sh
pnpm exec tsx src/backend/scripts/repair-terminal-legacy-runs.ts \
  --org=<org-id> --run=<run-id> --older-than=<ISO-timestamp>
```

Review the preview and repeat with `--apply`. The transaction rejects an active
run, live lease, linked durable job, recent message, or non-legacy identity. It
closes only stale initiating messages and active tasks, and preserves successful
tasks, run identity, artifacts, report rows, hashes, and exports. For a
succeeded run it attaches the existing published report reference when present.
This is an operator repair, not a public endpoint.

## Release B: executor removal gate

Remove the legacy executor and publisher only after the release A inventory
shows no queued/running legacy run or valid lease, historical routes and
exports pass, and no post-cutover legacy INSERT exists. The final worker must
claim only `agent-v1` runs. Keep historical readers and report export support.

If a gate fails, pause new mutation admission and scheduler ticks. Keep reads
available and use a post-cutover artifact that still writes only `agent-v1`.
Do not roll back to a binary that can insert legacy runs, remove the write
guard, rewrite old run versions, or drop historical data.

## Verification limits

The source migration and PGlite tests verify the write guard locally. Docker
could not connect to `dockerDesktopLinuxEngine` in this workspace. No Supabase
shadow diff, populated upgrade, or browser E2E has passed here. On a confirmed
disposable Supabase test stack, run the shadow diff against the checked-in
migrations, then exercise the populated legacy upgrade, guard INSERT/UPDATE,
readiness, and tenant RLS. Run `pnpm test:e2e` only on that disposable stack:
its web-server setup invokes `supabase start` and `supabase db reset --local`.
No live database inventory, migration application, canary, or drain has been
performed by this code change. The operator must record these results before
claiming deploy readiness or opening the release B removal gate.

# ADR: Profile Run Command Center

**Status:** Accepted (feature-flagged rollout)  
**Date:** 2026-08-19

## Context

The product previously exposed profiling, analysis sessions, agent answers, and
reports as separate workflows. The target experience is one evidence-oriented
workspace scoped to a Profile Run, while preserving the existing backend
boundaries and legacy URLs during migration.

## Decisions

1. The Command Center has four URL-addressable tabs: Overview, Explorer,
   Agent, and Report. The shell is mounted only when the frontend flag is on;
   inactive tabs are loaded lazily.
2. `UX_COMMAND_CENTER_ENABLED` is a backend fail-closed API flag and
   `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED` is an independent UI flag. Turning
   either relevant surface off restores the legacy path without database
   rollback.
3. Explorer accepts structured aggregate specifications only. A preview is a
   deterministic, bounded DuckDB sample and is marked approximate. Promotion
   creates a separately persisted official execution after context and quality
   checks; raw SQL and raw rows are never accepted as browser evidence.
4. Workspace context and theme are immutable version records with optimistic
   version checks. Report drafts pin the versions that were active when the
   draft was created and report stale dependencies explicitly.
5. A report pin stores the official execution identifier, normalized query,
   result hash, limitations, and export policy. Snapshot hashes are calculated
   from this server-side evidence payload.

## Consequences

- The migration is additive: it creates configuration and report-item tables
  and adds nullable/lifecycle columns needed for Command Center records.
- Existing Analysis, Notebook, and Report routes remain compatible for staged
  rollout. Primary navigation hides legacy entry points only while the UI flag
  is enabled.
- Preview and official executions are intentionally distinct. A preview cannot
  be used as report evidence until it is promoted and persisted as official.

## Rollback

Disable the flags, keep the additive schema and recorded drafts/evidence, and
return users to the existing routes. No destructive migration is part of
rollback.

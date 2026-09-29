# Agent productization status

This status follows the Agent Experience work in `docs/agent-experience-plan.md`. The implemented flow keeps one canonical Agent Runtime, persisted conversations/runs, pinned snapshot evidence, and the existing publication transaction.

| Milestone | State | Result |
| --- | --- | --- |
| M2 Agent UX | Implemented | Sidebar work state and recent failure, readable specialist/delegation cards, and reduced-motion transitions. |
| M3 Specialization | Implemented | Distinct operation input per specialist; Data evidence and Report revision are bounded by typed schemas. |
| M4 Skill | Implemented | Static versioned `slow-inventory-analysis` registry; Coordinator selects it and Reviewer validates required artifacts, metrics, and report evidence. |
| M5 Daily automation | Implemented | Existing durable scheduler retains timezone and idempotent occurrences; scheduled runs carry the use case and the UI shows skill and latest run. |
| M6 Telegram | Implemented behind server configuration | Exact chat/user allowlist, shared Agent Runtime turn, durable terminal-message delivery with retry, and concise `/status`, `/latest`, `/report` commands. |
| M7 Reviewer | Implemented | Persisted structured decisions, at most one revision, skill coverage check, safe issue categories in workflow status, and a publication gate that revalidates the draft/review. |

Telegram requires `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_BINDINGS_JSON` on the server. Each binding specifies `chat_id`, `telegram_user_id`, authorized workspace `user_id` and `org_id`, fixed `scope`, and IANA `timezone`; `agent_target` defaults to `coordinator`. Set the Telegram webhook to `POST /api/telegram/webhook` with the matching secret token header. Optional `VDA_PUBLIC_URL` adds a workspace link to results. No browser token or public binding endpoint is used.

Outbound Telegram delivery is at least once. A crash between Telegram accepting a message and recording `sent` can cause a repeat notification. The adapter has automated mock and database tests; a live bot handshake requires deployment credentials. The Reviewer remains deterministic unless a bounded correction provider is configured. No new runtime or skill discovery service was added.

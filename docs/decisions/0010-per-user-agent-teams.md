# 0010 · Every user has their own agent team

- **Context.** grokbot has one main session and one folder per agent. Self-improvement should learn one person's preferences.
- **Decision.** A domain provides credential sets and starters. Each user gets their own copy of every agent (folder, session, lead and queue). Each user belongs to exactly one domain.
- **Rejected.**
  - One shared team per domain: users would queue behind each other, memory would mix users, and per-user history would only be a filtered view of one context.
  - A shared domain folder plus a per-user overlay: merge rules between the layers.
- **Consequences.** Cost scales with users × agents, which is bounded by `MAX_AGENTS_PER_USER`. Isolation between users is simple. See [12](../12-auth-and-domains.md).

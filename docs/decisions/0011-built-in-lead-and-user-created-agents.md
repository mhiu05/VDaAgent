# 0011 · Built-in lead and user-created agents

- **Context.** Users should be able to build their own agents, but jev and the global queue need exactly one lead per user.
- **Decision.**
  - Every user gets a built-in lead (slug `lead`, "Điều phối") that can't be deleted. Its platform rules are fixed; its role prompt comes from the domain's `starters/lead/prompt.md` or `platform/lead/prompt.md`, and the user can edit it.
  - Every other agent (starters and custom agents) is a non-lead, created and customized in the builder.
  - `domain.yaml` holds no roster and no lead.
- **Rejected.**
  - The user picks any agent as lead: switching rules, and refusals while tasks are queued.
  - No lead until the user creates one: an empty first-run experience, and no queue.
- **Consequences.** A new user can chat immediately, and the queue always has an owner. See [04](../04-agent-folder.md#creating-an-agent) and [05](../05-agent-builder.md).

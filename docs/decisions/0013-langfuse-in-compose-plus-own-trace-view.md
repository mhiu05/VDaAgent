# 0013 · Langfuse in compose plus our own chat-trace view

- **Context.** Monitoring LLM calls (cost, tokens, latency, search) should be offloaded to an established tool, but still viewable from our compose stack. We also need a view no LLM tool provides: one agent's history as a chat, showing every action and the triggers from other agents and users.
- **Decision.**
  - Run Langfuse v4 (web, worker, ClickHouse, Redis, MinIO) in our compose stack, reusing our Postgres server.
  - Send traces with manual SDK v5 instrumentation, one trace per activation, using our own `trace_id`. Generation inputs are deltas, and cost comes from OpenRouter.
  - Build the chat-trace view ourselves, from our own tables, and deep-link each activation to Langfuse.
- **Rejected.**
  - Building a Langfuse-like UI ourselves: we'd be writing monitoring software.
  - Arize Phoenix: lighter, but a different product from the one requested.
  - The `langfuse.openai` drop-in: it records full contexts and prices from its own table.
  - Langfuse as the only source for the chat view: it can't link traces, and the view would break whenever Langfuse is down.
- **Consequences.** Five more containers. The two views are independent. See [13](../13-observability.md).

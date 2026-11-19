# 0019 · Retry with backoff instead of capping LLM concurrency

- **Context.** Every model call goes out on one OpenRouter key. Bursts (many users × agents, routines firing together) could hit 429s.
- **Decision.** No concurrency semaphore. Responses 429 and 5xx, and timeouts, are retried 3 times with exponential backoff (2, 4, 8 s, plus jitter), honouring `Retry-After`. When the retries run out, the harness appends an `error` event and the agent goes idle.
- **Rejected.** A global `MAX_CONCURRENT_LLM` semaphore: there's no technical need at PoC scale, and it would add queueing latency everywhere.
- **Consequences.** Under heavy load, agents see `model_unavailable` errors instead of waiting. A cap and per-user budgets are future work. See [03](../03-agent-loop.md#model-calls).

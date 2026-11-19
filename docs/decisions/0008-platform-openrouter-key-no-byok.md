# 0008 · One platform OpenRouter key, no BYOK

- **Context.** jev runs on every message to the lead and must always work, so it can't depend on whether a user brought a key. Agents, compaction and jev all need model access.
- **Decision.** One `OPENROUTER_API_KEY` in the root `.env` serves `AGENT_MODEL`, `JEV_MODEL` and `COMPACTION_MODEL`, through the OpenAI-compatible client. Domain credentials are separate files ([0009](0009-domain-credentials-as-files.md)).
- **Rejected.**
  - BYOK with required user keys: a user without an OpenRouter key couldn't use jev.
  - BYOK with a domain fallback: spend attribution and a second credential path.
  - LiteLLM as a provider abstraction: unnecessary when there is only one provider.
- **Consequences.** The platform pays for every call, and per-user budgets are future work. See [03](../03-agent-loop.md#model-calls).

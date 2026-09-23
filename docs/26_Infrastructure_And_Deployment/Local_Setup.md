# MVP Local Setup

VDaAgent's supported MVP development topology is a local Supabase-backed
Next.js application plus its separate worker process. It has no required
external queue, vector store, streaming service, or xAI dependency.

## Prerequisites

- Node.js 24 or later
- pnpm 11
- A local Supabase environment when exercising database-backed flows

Install workspace dependencies, configure the server-only values described in
`.env.example`, then start the application and worker in separate terminals:

```text
pnpm install
pnpm dev
pnpm dev:worker
```

The required provider configuration for the established application path is
Gemini as primary and OpenAI as fallback. API keys remain server-only. Do not
add `NEXT_PUBLIC_` prefixes to provider, database, or Supabase secret values.

## Agent Runtime flags

The P0 runtime is opt-in and defaults to the existing deterministic Agent Chat
path:

```text
GROK_RUNTIME_ENABLED=false
GROK_WORKSPACE_ENABLED=false
GROK_SSE_ENABLED=false
AGENT_LLM_PRIMARY_PROVIDER=gemini
AGENT_LLM_FALLBACK_PROVIDER=openai
```

Set `GROK_RUNTIME_ENABLED=true` only after Gemini and OpenAI credentials are
configured. xAI is an optional adapter: it is selected only when an operator
explicitly sets it as a runtime provider and supplies its server-side key and
model. The optional workspace layout and SSE activity presentation do not
affect JSON turn correctness or analysis polling.

## Local MVP checks

Run the following before handing off a local MVP change:

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm check:security
pnpm check:docs
```

Database-backed integration tests use PGlite fixtures and run serially. Their
extended fixture lease is test-only; production workers retain their normal
fenced lease and renewal behavior.

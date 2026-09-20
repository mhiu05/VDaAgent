# MVP local configuration

VDaAgent requires `APP_MODE=supabase` in every environment. Copy `.env.example` to `.env` and set
all four Supabase variables:

When running `next dev`, the role selector is enabled by default so a developer can enter as the
seeded `owner`, `analyst`, or `viewer` account without typing credentials. It is a development-only
shortcut, backed by a short-lived httpOnly cookie, and cannot be enabled in production. Set
`DEVELOPMENT_ROLE_BYPASS=false` to test the normal Supabase Auth login flow locally.

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are safe for the browser.
- `SUPABASE_SECRET_KEY` and `SUPABASE_DB_URL` are server/worker-only. Never prefix either with
  `NEXT_PUBLIC_`, commit them, or print them in logs.

Gemini remains the required primary provider and OpenAI the required fallback. Their API keys and
model names must also be configured before starting the web process or worker.

For a hosted project, copy `SUPABASE_DB_URL` from Supabase Dashboard → Connect. Prefer the Session
Pooler connection string on IPv4-only environments; the PostgreSQL driver requires TLS. Local values
come from the local Supabase stack, not from a hosted project.

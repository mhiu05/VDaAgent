# MVP Supabase local setup

VDaAgent has one runtime architecture: Supabase Auth + PostgreSQL + Storage. Docker Desktop (or a
Docker API-compatible runtime), Node.js 24+ and pnpm 11.0.8 are required.

```sh
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:reset
```

`db:reset` applies the declarative schemas and migrations under `src/backend/supabase`, provisions
the private `source-imports` and `report-exports` buckets idempotently, and loads local synthetic
test data. It only targets the local stack. Do not point this workflow at a hosted project.

Create `.env` from `.env.example`, then get the local connection values with Supabase CLI without
adding them to a shell history or log. For hosted environments, obtain the database connection string
from Dashboard → Connect; choose Session Pooler where the host supports IPv4 only. The application
enforces TLS for PostgreSQL connections.

Run both processes with `pnpm dev`, or separately with `pnpm dev:web` and `pnpm dev:worker`.
Create production users in Supabase Dashboard → Authentication → Users (or through an approved
server-side administrative workflow), then add organization membership with the existing protected
database workflow. Browser code uses only the publishable key.

Apply schema changes by editing the declarative files in `src/backend/supabase/schemas`, generating
and reviewing a migration with the Supabase CLI, then applying it to a dedicated local or staging
environment. Never reset, seed, or run E2E against a production project.

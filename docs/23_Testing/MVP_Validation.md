# MVP validation

Run the normal checks from the repository root:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:db
pnpm test:e2e
```

`pnpm test` uses PGlite (embedded PostgreSQL) with the canonical Supabase migration and an explicit
storage test double. `pnpm test:db` runs pgTAP RLS coverage against the local Supabase stack.
`pnpm test:e2e` starts and resets only the local Supabase test stack, then signs in through
`/api/v1/auth/login` using the local Auth accounts seeded in `supabase/seed.sql`. It must not be
configured with hosted production credentials.

## Analytics hardening matrix

| Scenario | Deterministic coverage |
| --- | --- |
| Healthy inventory / chart-report agreement | `semantic.test.ts`, `chart-builder.test.ts`, `pipeline.test.ts` |
| Aging deterioration and responsible segment | notable-change, breakdown, and chart binding cases in `semantic.test.ts` and `chart-builder.test.ts` |
| Price divergence | exact-cohort median/gap case in `semantic.test.ts`; peer chart provenance in `chart-builder.test.ts` |
| Missing age | quality-limitation propagation case in `semantic.test.ts` |
| Insufficient peers | exact-cohort abstention case in `semantic.test.ts` |
| Insufficient history | missing-history semantic and unavailable-chart cases |
| Retry after partial completion | query validation recovery and provider-failure reuse cases in `pipeline.test.ts` |
| Tenant and lineage isolation | cross-tenant semantic/chart/report cases, repository tests, and `tenant_rls.test.sql` |
| Adversarial LLM output | invented, duplicate, and missing claim-ID cases in `provider.test.ts`; fabricated claim/path cases in `pipeline.test.ts` |

The release gate requires every command above to pass. A skipped database or E2E command must be
reported as unverified rather than treated as a pass.

# Mock warehouse import

Run from the repository root. The scripts read only `vda_vinhomes_mock/curated/` and require
`WAREHOUSE_DB_URL`; they never fall back to `SUPABASE_DB_URL`.

```sh
pnpm mock-data:validate-source
pnpm mock-data:import -- --batch-size 2000
pnpm mock-data:validate-import
```

The import is streaming, batch-based, retry-safe, and idempotent. It preserves source UUIDs,
uses `ON CONFLICT DO NOTHING`, and refuses a tenant that already has non-`MOCK_ONLY` rows.
It intentionally excludes `raw/`, `quarantine/`, and `vda_unit_snapshots.csv`.

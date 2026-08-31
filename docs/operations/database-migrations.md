# Database migrations

Alembic is the production schema source of truth. Application startup never
creates or alters production tables.

## Fresh database

From the repository root, configure `DATABASE_MIGRATION_URL` (or
`DATABASE_URL`) and run:

```bash
alembic -c alembic.ini upgrade head
alembic -c alembic.ini current
alembic -c alembic.ini heads
alembic -c alembic.ini check
```

The migration chain starts at `20260812_0000`, the explicit pre-Alembic
baseline, and currently ends at `20260831_0021`.

## Existing pre-Alembic database

Do not run `alembic stamp` directly. First run the read-only verifier:

```bash
python scripts/adopt_legacy_database.py
```

Only if verification passes, stamp the database at the historical baseline and
immediately run the normal upgrade:

```bash
python scripts/adopt_legacy_database.py --stamp
alembic -c alembic.ini upgrade head
```

The verifier checks all required baseline tables, columns, types, nullability,
and primary keys. It rejects partial or incompatible schemas before writing an
Alembic version. It also refuses databases that already contain an
`alembic_version` table; those databases must use the regular Alembic upgrade
path. Adoption is data-preserving and never calls SQLAlchemy `create_all()`.

CI runs `scripts/migration_smoke.py`, which creates isolated PostgreSQL
databases for both a fresh upgrade and an upgrade from the deployed pre-fix
revision, verifies the head, runs `alembic check`, asserts the RLS/grant
boundary with actual browser roles, and removes only those temporary databases.

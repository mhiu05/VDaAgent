import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import postgres from 'postgres';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATASET = resolve(ROOT, 'vda_vinhomes_mock');
const MARKER = 'MOCK_ONLY';

type Manifest = {
  totals: Record<string, number>;
};
type Counts = Record<string, string>;

async function environmentValue(name: string): Promise<string | undefined> {
  if (process.env[name]) return process.env[name];
  try {
    const source = await readFile(resolve(ROOT, '.env'), 'utf8');
    const line = source.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
    if (!line) return undefined;
    return line
      .slice(name.length + 1)
      .trim()
      .replace(/^(?:"|')|(?:"|')$/g, '');
  } catch {
    return undefined;
  }
}

function integer(value: string | number | undefined): number {
  const result = Number(value);
  if (!Number.isFinite(result))
    throw new Error('database returned a non-numeric validation result');
  return result;
}

async function mockOrganizationId(): Promise<string> {
  const source = await readFile(resolve(DATASET, 'curated/dim_organizations.csv'), 'utf8');
  const rows = parse(source, { columns: true, skip_empty_lines: true }) as Array<{
    org_id?: string;
  }>;
  if (rows.length !== 1 || !rows[0].org_id)
    throw new Error('expected exactly one curated mock organization');
  return rows[0].org_id;
}

function ensure(name: string, actual: number, expected: number, errors: string[]): void {
  if (actual !== expected) errors.push(`${name}: expected ${expected}, got ${actual}`);
}

function ensureZero(name: string, actual: number, errors: string[]): void {
  ensure(name, actual, 0, errors);
}

async function main(): Promise<void> {
  const databaseUrl = await environmentValue('WAREHOUSE_DB_URL');
  if (!databaseUrl)
    throw new Error('WAREHOUSE_DB_URL is required; SUPABASE_DB_URL is never used here');
  const [manifest, orgId] = await Promise.all([
    readFile(resolve(DATASET, 'manifest.json'), 'utf8').then(
      (value) => JSON.parse(value) as Manifest,
    ),
    mockOrganizationId(),
  ]);
  const sql = postgres(databaseUrl, {
    max: 2,
    idle_timeout: 20,
    connect_timeout: 20,
    prepare: false,
  });
  try {
    const errors: string[] = [];
    const counts = (
      await sql.unsafe<Counts[]>(
        `
      SELECT
        (SELECT count(*) FROM public.organizations WHERE org_id = $1 AND synthetic_marker = $2)::text AS organizations,
        (SELECT count(*) FROM public.markets WHERE org_id = $1 AND synthetic_marker = $2)::text AS markets,
        (SELECT count(*) FROM public.projects WHERE org_id = $1 AND synthetic_marker = $2)::text AS projects,
        (SELECT count(*) FROM public.zones WHERE org_id = $1 AND synthetic_marker = $2)::text AS zones,
        (SELECT count(*) FROM public.units WHERE org_id = $1 AND synthetic_marker = $2)::text AS units,
        (SELECT count(*) FROM public.snapshots WHERE org_id = $1 AND synthetic_marker = $2)::text AS inventory_snapshots,
        (SELECT count(*) FROM public.inventory_transactions WHERE org_id = $1 AND synthetic_marker = $2)::text AS transactions,
        (SELECT count(*) FROM public.unit_price_history WHERE org_id = $1 AND synthetic_marker = $2)::text AS price_history,
        (SELECT count(*) FROM public.unit_reservations WHERE org_id = $1 AND synthetic_marker = $2)::text AS reservations
    `,
        [orgId, MARKER],
      )
    )[0];
    ensure('organizations', integer(counts.organizations), 1, errors);
    ensure('markets', integer(counts.markets), manifest.totals.markets, errors);
    ensure('projects', integer(counts.projects), manifest.totals.projects, errors);
    ensure('zones', integer(counts.zones), manifest.totals.zones, errors);
    ensure('units', integer(counts.units), manifest.totals.dim_units, errors);
    ensure(
      'inventory snapshots',
      integer(counts.inventory_snapshots),
      manifest.totals.fact_inventory_snapshot,
      errors,
    );
    ensure('transactions', integer(counts.transactions), manifest.totals.fact_transaction, errors);
    ensure(
      'price history',
      integer(counts.price_history),
      manifest.totals.fact_price_history,
      errors,
    );
    ensure('reservations', integer(counts.reservations), manifest.totals.fact_reservation, errors);

    const [duplicates, foreignKeys, lifecycle, domains, tenant, rls] = await Promise.all([
      sql.unsafe<Counts[]>(
        `
        SELECT
          (SELECT count(*) FROM (SELECT unit_external_id FROM public.units WHERE org_id = $1 GROUP BY unit_external_id HAVING count(*) > 1) duplicate_units)::text AS duplicate_units,
          (SELECT count(*) FROM (SELECT project_external_id FROM public.projects WHERE org_id = $1 GROUP BY project_external_id HAVING count(*) > 1) duplicate_projects)::text AS duplicate_projects,
          (SELECT count(*) FROM (SELECT zone_external_id FROM public.zones WHERE org_id = $1 GROUP BY zone_external_id HAVING count(*) > 1) duplicate_zones)::text AS duplicate_zones,
          (SELECT count(*) FROM (SELECT unit_external_id, snapshot_date FROM public.snapshots WHERE org_id = $1 AND synthetic_marker = $2 GROUP BY unit_external_id, snapshot_date HAVING count(*) > 1) duplicate_snapshots)::text AS duplicate_snapshots,
          (SELECT count(*) FROM (SELECT transaction_id FROM public.inventory_transactions WHERE org_id = $1 GROUP BY transaction_id HAVING count(*) > 1) duplicate_transactions)::text AS duplicate_transactions,
          (SELECT count(*) FROM (SELECT price_history_id FROM public.unit_price_history WHERE org_id = $1 GROUP BY price_history_id HAVING count(*) > 1) duplicate_price_history)::text AS duplicate_price_history,
          (SELECT count(*) FROM (SELECT reservation_id FROM public.unit_reservations WHERE org_id = $1 GROUP BY reservation_id HAVING count(*) > 1) duplicate_reservations)::text AS duplicate_reservations
      `,
        [orgId, MARKER],
      ),
      sql.unsafe<Counts[]>(
        `
        SELECT
          (SELECT count(*) FROM public.projects p LEFT JOIN public.markets m ON m.org_id = p.org_id AND m.market_external_id = p.market_external_id WHERE p.org_id = $1 AND m.org_id IS NULL)::text AS project_market_orphans,
          (SELECT count(*) FROM public.zones z LEFT JOIN public.projects p ON p.org_id = z.org_id AND p.project_external_id = z.project_external_id WHERE z.org_id = $1 AND p.org_id IS NULL)::text AS zone_project_orphans,
          (SELECT count(*) FROM public.units u LEFT JOIN public.zones z ON z.org_id = u.org_id AND z.zone_external_id = u.zone_external_id AND z.project_external_id = u.project_external_id WHERE u.org_id = $1 AND z.org_id IS NULL)::text AS unit_zone_orphans,
          (SELECT count(*) FROM public.snapshots s LEFT JOIN public.units u ON u.org_id = s.org_id AND u.unit_external_id = s.unit_external_id AND u.project_external_id = s.project_external_id AND u.zone_external_id = s.zone_external_id WHERE s.org_id = $1 AND s.synthetic_marker = $2 AND u.org_id IS NULL)::text AS snapshot_unit_orphans,
          (SELECT count(*) FROM public.inventory_transactions t LEFT JOIN public.units u ON u.org_id = t.org_id AND u.unit_external_id = t.unit_external_id AND u.project_external_id = t.project_external_id AND u.zone_external_id = t.zone_external_id WHERE t.org_id = $1 AND u.org_id IS NULL)::text AS transaction_unit_orphans,
          (SELECT count(*) FROM public.unit_price_history h LEFT JOIN public.units u ON u.org_id = h.org_id AND u.unit_external_id = h.unit_external_id AND u.project_external_id = h.project_external_id WHERE h.org_id = $1 AND u.org_id IS NULL)::text AS price_unit_orphans,
          (SELECT count(*) FROM public.unit_reservations r LEFT JOIN public.units u ON u.org_id = r.org_id AND u.unit_external_id = r.unit_external_id AND u.project_external_id = r.project_external_id WHERE r.org_id = $1 AND u.org_id IS NULL)::text AS reservation_unit_orphans
      `,
        [orgId, MARKER],
      ),
      sql.unsafe<Counts[]>(
        `
        SELECT
          (SELECT count(*) FROM public.snapshots WHERE org_id = $1 AND synthetic_marker = $2 AND ((payload->>'available_since')::date > snapshot_date OR (payload->>'sold_at')::date > snapshot_date OR (payload->>'status' = 'sold' AND NULLIF(payload->>'sold_at', '') IS NULL)))::text AS invalid_inventory_lifecycle,
          (SELECT count(*) FROM public.unit_reservations WHERE org_id = $1 AND reservation_date > expiry_date)::text AS invalid_reservation_lifecycle
      `,
        [orgId, MARKER],
      ),
      sql.unsafe<Counts[]>(
        `
        SELECT
          (SELECT count(*) FROM public.snapshots WHERE org_id = $1 AND synthetic_marker = $2 AND (country_code <> 'VN' OR currency <> 'VND' OR synthetic_marker <> $2))::text AS invalid_inventory_domain,
          (SELECT count(*) FROM public.markets WHERE org_id = $1 AND (country_code <> 'VN' OR currency <> 'VND' OR synthetic_marker <> $2))::text AS invalid_market_domain,
          ((SELECT count(*) FROM public.inventory_transactions WHERE org_id = $1 AND (currency <> 'VND' OR synthetic_marker <> $2)) + (SELECT count(*) FROM public.unit_price_history WHERE org_id = $1 AND (currency <> 'VND' OR synthetic_marker <> $2)) + (SELECT count(*) FROM public.unit_reservations WHERE org_id = $1 AND (currency <> 'VND' OR synthetic_marker <> $2)))::text AS invalid_fact_domain
      `,
        [orgId, MARKER],
      ),
      sql.unsafe<Counts[]>(
        `
        SELECT (
          (SELECT count(*) FROM public.organizations WHERE org_id <> $1 AND synthetic_marker = $2) +
          (SELECT count(*) FROM public.markets WHERE org_id <> $1 AND synthetic_marker = $2) +
          (SELECT count(*) FROM public.projects WHERE org_id <> $1 AND synthetic_marker = $2) +
          (SELECT count(*) FROM public.zones WHERE org_id <> $1 AND synthetic_marker = $2) +
          (SELECT count(*) FROM public.units WHERE org_id <> $1 AND synthetic_marker = $2) +
          (SELECT count(*) FROM public.snapshots WHERE org_id <> $1 AND synthetic_marker = $2) +
          (SELECT count(*) FROM public.inventory_transactions WHERE org_id <> $1 AND synthetic_marker = $2) +
          (SELECT count(*) FROM public.unit_price_history WHERE org_id <> $1 AND synthetic_marker = $2) +
          (SELECT count(*) FROM public.unit_reservations WHERE org_id <> $1 AND synthetic_marker = $2)
        )::text AS mock_rows_outside_tenant
      `,
        [orgId, MARKER],
      ),
      sql.unsafe<Counts[]>(`
        SELECT
          (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('organizations','imports','snapshots','markets','projects','zones','units','inventory_transactions','unit_price_history','unit_reservations') AND NOT c.relrowsecurity)::text AS rls_disabled_tables,
          (SELECT count(DISTINCT tablename) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('organizations','imports','snapshots','markets','projects','zones','units','inventory_transactions','unit_price_history','unit_reservations') AND policyname = 'workspace_read')::text AS workspace_read_policies
      `),
    ]);
    for (const [name, value] of Object.entries(duplicates[0]))
      ensureZero(name, integer(value), errors);
    for (const [name, value] of Object.entries(foreignKeys[0]))
      ensureZero(name, integer(value), errors);
    for (const [name, value] of Object.entries(lifecycle[0]))
      ensureZero(name, integer(value), errors);
    for (const [name, value] of Object.entries(domains[0]))
      ensureZero(name, integer(value), errors);
    ensureZero('mock rows outside tenant', integer(tenant[0].mock_rows_outside_tenant), errors);
    ensureZero('RLS disabled tables', integer(rls[0].rls_disabled_tables), errors);
    ensure('workspace_read policies', integer(rls[0].workspace_read_policies), 10, errors);

    const result = {
      passed: errors.length === 0,
      counts: Object.fromEntries(
        Object.entries(counts).map(([key, value]) => [key, integer(value)]),
      ),
      checks: {
        duplicates: Object.fromEntries(
          Object.entries(duplicates[0]).map(([key, value]) => [key, integer(value)]),
        ),
        foreign_keys: Object.fromEntries(
          Object.entries(foreignKeys[0]).map(([key, value]) => [key, integer(value)]),
        ),
        lifecycle: Object.fromEntries(
          Object.entries(lifecycle[0]).map(([key, value]) => [key, integer(value)]),
        ),
        domains: Object.fromEntries(
          Object.entries(domains[0]).map(([key, value]) => [key, integer(value)]),
        ),
        mock_rows_outside_tenant: integer(tenant[0].mock_rows_outside_tenant),
        rls_disabled_tables: integer(rls[0].rls_disabled_tables),
        workspace_read_policies: integer(rls[0].workspace_read_policies),
      },
      errors,
    };
    console.info(JSON.stringify(result, null, 2));
    if (errors.length) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 10 });
  }
}

void main().catch((error: unknown) => {
  console.error(
    `Mock import validation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});

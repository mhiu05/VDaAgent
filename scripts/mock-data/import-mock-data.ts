import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';
import postgres from 'postgres';

type RawRecord = Record<string, string>;
type RowValues = readonly unknown[];
type SqlClient = ReturnType<typeof postgres>;

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATASET_ROOT = resolve(REPOSITORY_ROOT, 'vda_vinhomes_mock');
const CURATED_ROOT = resolve(DATASET_ROOT, 'curated');
const MOCK_MARKER = 'MOCK_ONLY';
const DEFAULT_BATCH_SIZE = 1_000;

const HEADERS = {
  organization: [
    'org_id',
    'organization_name',
    'country_code',
    'dataset_version',
    'synthetic_marker',
  ],
  market: [
    'market_external_id',
    'market_code',
    'market_name',
    'country_code',
    'currency',
    'dataset_version',
    'synthetic_marker',
  ],
  project: [
    'project_external_id',
    'project_name',
    'market_external_id',
    'market_name',
    'project_type',
    'launch_date',
    'expected_handover_date',
    'total_units',
    'project_status',
    'price_segment',
    'synthetic_marker',
  ],
  zone: [
    'zone_external_id',
    'zone_name',
    'project_external_id',
    'project_name',
    'zone_sequence',
    'building_block_count',
    'total_units',
    'dataset_version',
    'synthetic_marker',
  ],
  unit: [
    'unit_external_id',
    'unit_code',
    'org_id',
    'market_external_id',
    'project_external_id',
    'zone_external_id',
    'unit_type',
    'area_sqm',
    'bedrooms',
    'floor_number',
    'building_block',
    'view_type',
    'orientation',
    'initial_list_price',
    'currency',
    'launch_date',
    'dataset_version',
    'synthetic_marker',
  ],
  inventory: [
    'org_id',
    'snapshot_id',
    'import_id',
    'snapshot_date',
    'country_code',
    'market_external_id',
    'market_name',
    'project_external_id',
    'project_name',
    'zone_external_id',
    'zone_name',
    'unit_external_id',
    'unit_code',
    'unit_type',
    'area_sqm',
    'list_price',
    'currency',
    'status',
    'available_since',
    'sold_at',
    'bedrooms',
    'floor_number',
    'building_block',
    'view_type',
    'orientation',
    'handover_status',
    'sales_channel',
    'source_system',
    'batch_id',
    'dataset_version',
    'synthetic_marker',
  ],
  transaction: [
    'transaction_id',
    'org_id',
    'unit_external_id',
    'project_external_id',
    'zone_external_id',
    'transaction_date',
    'transaction_type',
    'transaction_status',
    'currency',
    'gross_amount',
    'discount_amount',
    'net_amount',
    'payment_method',
    'sales_channel',
    'customer_segment',
    'agent_external_id',
    'contract_type',
    'cancellation_reason',
    'dataset_version',
    'synthetic_marker',
  ],
  priceHistory: [
    'price_history_id',
    'org_id',
    'unit_external_id',
    'project_external_id',
    'effective_date',
    'previous_price',
    'new_price',
    'currency',
    'change_percent',
    'change_reason',
    'approved_by',
    'dataset_version',
    'synthetic_marker',
  ],
  reservation: [
    'reservation_id',
    'org_id',
    'unit_external_id',
    'project_external_id',
    'reservation_date',
    'expiry_date',
    'status',
    'deposit_amount',
    'currency',
    'sales_channel',
    'customer_segment',
    'cancellation_reason',
    'dataset_version',
    'synthetic_marker',
  ],
} as const;

type HeaderKey = keyof typeof HEADERS;

type Manifest = {
  dataset_version: string;
  synthetic_marker: string;
  row_counts: Record<string, number>;
  totals: Record<string, number>;
  snapshot_dates: string[];
};

type SourceImport = {
  importId: string;
  snapshotDate: string;
  rowCount: number;
};

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function environmentValue(name: string): Promise<string | undefined> {
  if (process.env[name]) return process.env[name];
  const dotenvPath = resolve(REPOSITORY_ROOT, '.env');
  let source: string;
  try {
    source = await readFile(dotenvPath, 'utf8');
  } catch {
    return undefined;
  }
  const line = source.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  if (!line) return undefined;
  const value = line.slice(name.length + 1).trim();
  return value.replace(/^(?:"|')|(?:"|')$/g, '');
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value;
}

function integer(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`invalid integer ${field}`);
  return parsed;
}

function nullableInteger(value: string, field: string): number | null {
  return value === '' ? null : integer(value, field);
}

function assertRecord(row: RawRecord, datasetVersion: string, orgId: string, file: string): void {
  if (row.synthetic_marker !== MOCK_MARKER)
    throw new Error(`${file}: synthetic_marker must be ${MOCK_MARKER}`);
  if ('dataset_version' in row && row.dataset_version !== datasetVersion)
    throw new Error(`${file}: unexpected dataset_version`);
  if ('org_id' in row && row.org_id !== orgId) throw new Error(`${file}: cross-organization row`);
}

async function* records(file: string, headerKey: HeaderKey): AsyncGenerator<RawRecord> {
  const expected = HEADERS[headerKey];
  const stream = createReadStream(file, { encoding: 'utf8' });
  let headerSeen = false;
  const parser = parse({
    bom: true,
    columns(headers: string[]) {
      if (headers.length !== expected.length || headers.some((header, i) => header !== expected[i]))
        throw new Error(`${file}: CSV header does not match ${headerKey}`);
      headerSeen = true;
      return headers;
    },
    skip_empty_lines: true,
    relax_column_count: false,
  });
  stream.pipe(parser);
  try {
    for await (const row of parser) yield row as RawRecord;
    if (!headerSeen) throw new Error(`${file}: missing CSV header`);
  } finally {
    stream.destroy();
  }
}

async function firstRecord(file: string, headerKey: HeaderKey): Promise<RawRecord> {
  const iterator = records(file, headerKey);
  try {
    const first = await iterator.next();
    if (first.done || !first.value) throw new Error(`${file}: expected at least one data row`);
    return first.value;
  } finally {
    await iterator.return?.(undefined as never);
  }
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function factFiles(prefix: string, expectedShards: number): Promise<string[]> {
  const files = (await readdir(CURATED_ROOT))
    .filter((name) => new RegExp(`^${prefix}_\\d{3}\\.csv$`).test(name))
    .sort()
    .map((name) => resolve(CURATED_ROOT, name));
  if (files.length !== expectedShards)
    throw new Error(`${prefix}: expected ${expectedShards} curated shards, found ${files.length}`);
  return files;
}

async function inventoryImports(
  files: readonly string[],
  orgId: string,
  datasetVersion: string,
  expectedImportCount: number,
): Promise<SourceImport[]> {
  const imports = new Map<string, SourceImport>();
  for (const file of files) {
    for await (const row of records(file, 'inventory')) {
      assertRecord(row, datasetVersion, orgId, file);
      const prior = imports.get(row.import_id);
      if (prior && prior.snapshotDate !== row.snapshot_date)
        throw new Error(`${file}: import_id is associated with multiple snapshot dates`);
      if (prior) prior.rowCount += 1;
      else
        imports.set(row.import_id, {
          importId: row.import_id,
          snapshotDate: row.snapshot_date,
          rowCount: 1,
        });
    }
  }
  if (imports.size !== expectedImportCount)
    throw new Error(
      `expected ${expectedImportCount} deterministic inventory import ids, found ${imports.size}`,
    );
  return [...imports.values()].sort((left, right) =>
    left.snapshotDate.localeCompare(right.snapshotDate),
  );
}

function transient(error: unknown): boolean {
  const code = typeof error === 'object' && error ? (error as { code?: string }).code : undefined;
  const message = error instanceof Error ? error.message : '';
  return (
    ['08000', '08003', '08006', '25006', '40001', '40P01', '53300', '57P01', '57P02'].includes(
      code ?? '',
    ) || /ECONNRESET|EPIPE|timeout|connection/i.test(message)
  );
}

async function retry<T>(operation: () => Promise<T>, recover?: () => Promise<void>): Promise<T> {
  let latest: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      latest = error;
      if (!transient(error) || attempt === 2) throw error;
      if (recover) {
        try {
          await recover();
        } catch (recoveryError) {
          latest = recoveryError;
          if (!transient(recoveryError) || attempt === 2) throw recoveryError;
        }
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * 2 ** attempt));
    }
  }
  throw latest;
}

async function enableWriteSession(sql: SqlClient): Promise<void> {
  // Scope the recovery to the importer connection only. This does not alter the
  // database default, roles, RLS policies, or any data outside this import.
  await sql.unsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE');
  await sql.unsafe('SET default_transaction_read_only = off');
}

async function insertRows(
  sql: SqlClient,
  table: string,
  columns: readonly string[],
  values: readonly RowValues[],
  conflict: string,
): Promise<void> {
  if (!values.length) return;
  const placeholders = values
    .map(
      (_, rowIndex) =>
        `(${columns.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(',')})`,
    )
    .join(',');
  const statement = `INSERT INTO ${table} (${columns.map(quoteIdentifier).join(',')}) VALUES ${placeholders} ${conflict}`;
  await retry(
    () => sql.unsafe(statement, values.flat() as never[]).then(() => undefined),
    () => enableWriteSession(sql),
  );
}

async function importFiles(
  sql: SqlClient,
  label: string,
  files: readonly string[],
  headerKey: HeaderKey,
  orgId: string,
  datasetVersion: string,
  batchSize: number,
  toValues: (row: RawRecord) => RowValues,
  target: { table: string; columns: readonly string[]; conflict: string },
): Promise<number> {
  let processed = 0;
  let batch: RowValues[] = [];
  const effectiveBatchSize = Math.min(batchSize, Math.floor(60_000 / target.columns.length));
  let nextProgressLog = 10_000;
  for (const file of files) {
    for await (const row of records(file, headerKey)) {
      assertRecord(row, datasetVersion, orgId, file);
      batch.push(toValues(row));
      processed += 1;
      if (batch.length === effectiveBatchSize) {
        await insertRows(sql, target.table, target.columns, batch, target.conflict);
        batch = [];
        if (processed >= nextProgressLog) {
          console.info(`${label}: ${processed.toLocaleString()} rows processed`);
          nextProgressLog = (Math.floor(processed / 10_000) + 1) * 10_000;
        }
      }
    }
  }
  if (batch.length) await insertRows(sql, target.table, target.columns, batch, target.conflict);
  console.info(`${label}: ${processed.toLocaleString()} rows processed`);
  return processed;
}

async function assertTargetSchema(sql: SqlClient): Promise<void> {
  const result = await sql.unsafe<{ tablename: string }[]>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'organizations', 'imports', 'snapshots', 'markets', 'projects', 'zones', 'units',
        'inventory_transactions', 'unit_price_history', 'unit_reservations'
      )
  `);
  if (result.length !== 10)
    throw new Error('mock warehouse schema is not installed; apply the pending migrations first');
}

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  if (!argumentsList.includes('--import')) {
    throw new Error(
      'usage: pnpm exec tsx scripts/mock-data/import-mock-data.ts --import [--batch-size 1000]',
    );
  }
  const batchSizeIndex = argumentsList.indexOf('--batch-size');
  const batchSize =
    batchSizeIndex === -1
      ? DEFAULT_BATCH_SIZE
      : integer(required(argumentsList[batchSizeIndex + 1], '--batch-size'), 'batch size');
  if (batchSize < 100 || batchSize > 5_000)
    throw new Error('batch size must be between 100 and 5000');

  const databaseUrl = required(
    await environmentValue('WAREHOUSE_DB_URL'),
    'WAREHOUSE_DB_URL (this importer intentionally never falls back to SUPABASE_DB_URL)',
  );
  const manifest = JSON.parse(
    await readFile(resolve(DATASET_ROOT, 'manifest.json'), 'utf8'),
  ) as Manifest;
  if (manifest.synthetic_marker !== MOCK_MARKER)
    throw new Error('manifest is not marked MOCK_ONLY');
  const checksumLines = await readFile(resolve(DATASET_ROOT, 'checksums.sha256'), 'utf8');
  const expectedManifestChecksum = checksumLines
    .split(/\r?\n/)
    .find((line) => line.endsWith('  manifest.json'))
    ?.split('  ')[0];
  if (
    !expectedManifestChecksum ||
    (await sha256(resolve(DATASET_ROOT, 'manifest.json'))) !== expectedManifestChecksum
  )
    throw new Error('manifest checksum verification failed');

  const organizationFile = resolve(CURATED_ROOT, 'dim_organizations.csv');
  const organization = await firstRecord(organizationFile, 'organization');
  const orgId = organization.org_id;
  assertRecord(organization, manifest.dataset_version, orgId, organizationFile);
  const inventoryFiles = await factFiles('fact_inventory_snapshot', 12);
  const sourceImports = await inventoryImports(
    inventoryFiles,
    orgId,
    manifest.dataset_version,
    manifest.snapshot_dates.length,
  );

  const sql = postgres(databaseUrl, {
    // The warehouse URL defaults sessions to read-only. This changes only this trusted
    // import session; it does not disable RLS or alter any role, policy, or database default.
    max: 1,
    idle_timeout: 20,
    connect_timeout: 20,
    prepare: false,
  });
  try {
    await enableWriteSession(sql);
    await assertTargetSchema(sql);
    const existing = await sql.unsafe<{ synthetic_marker: string | null }[]>(
      'SELECT synthetic_marker FROM public.organizations WHERE org_id = $1',
      [orgId],
    );
    if (existing.some((row) => row.synthetic_marker !== MOCK_MARKER))
      throw new Error('the mock organization id is already associated with non-mock data');
    const unsafeSnapshotCount = await sql.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count
       FROM public.snapshots
       WHERE org_id = $1 AND COALESCE(synthetic_marker, '') <> $2`,
      [orgId, MOCK_MARKER],
    );
    if (unsafeSnapshotCount[0]?.count !== '0')
      throw new Error('the mock organization already contains non-mock snapshots');

    await insertRows(
      sql,
      'public.organizations',
      ['org_id', 'name', 'country_code', 'dataset_version', 'synthetic_marker'],
      [
        [
          orgId,
          organization.organization_name,
          organization.country_code,
          manifest.dataset_version,
          MOCK_MARKER,
        ],
      ],
      'ON CONFLICT (org_id) DO NOTHING',
    );
    await insertRows(
      sql,
      'public.imports',
      ['org_id', 'id', 'file_hash', 'payload', 'dataset_version', 'synthetic_marker'],
      sourceImports.map((sourceImport) => {
        const fileHash = createHash('sha256')
          .update(`${expectedManifestChecksum}:${sourceImport.importId}`)
          .digest('hex');
        const importManifest = {
          import_id: sourceImport.importId,
          org_id: orgId,
          created_by: orgId,
          created_at: `${sourceImport.snapshotDate}T00:00:00.000Z`,
          source_name: `vda_vinhomes_mock/curated inventory snapshot (${sourceImport.snapshotDate})`,
          file_hash: fileHash,
          row_count: sourceImport.rowCount,
          storage_path: null,
          schema_version: 'csv-v1',
          provisional: true,
        };
        return [
          orgId,
          sourceImport.importId,
          fileHash,
          JSON.stringify(importManifest),
          manifest.dataset_version,
          MOCK_MARKER,
        ];
      }),
      'ON CONFLICT (org_id, id) DO NOTHING',
    );

    const single = (name: string) => [resolve(CURATED_ROOT, name)];
    const imported = {
      markets: await importFiles(
        sql,
        'markets',
        single('dim_markets.csv'),
        'market',
        orgId,
        manifest.dataset_version,
        batchSize,
        (row) => [
          orgId,
          row.market_external_id,
          row.market_code,
          row.market_name,
          row.country_code,
          row.currency,
          row.dataset_version,
          row.synthetic_marker,
        ],
        {
          table: 'public.markets',
          columns: [
            'org_id',
            'market_external_id',
            'market_code',
            'market_name',
            'country_code',
            'currency',
            'dataset_version',
            'synthetic_marker',
          ],
          conflict: 'ON CONFLICT (org_id, market_external_id) DO NOTHING',
        },
      ),
      projects: await importFiles(
        sql,
        'projects',
        single('dim_projects.csv'),
        'project',
        orgId,
        manifest.dataset_version,
        batchSize,
        (row) => [
          orgId,
          row.project_external_id,
          row.project_name,
          row.market_external_id,
          row.project_type,
          row.launch_date,
          row.expected_handover_date,
          integer(row.total_units, 'total_units'),
          row.project_status,
          row.price_segment,
          manifest.dataset_version,
          row.synthetic_marker,
        ],
        {
          table: 'public.projects',
          columns: [
            'org_id',
            'project_external_id',
            'project_name',
            'market_external_id',
            'project_type',
            'launch_date',
            'expected_handover_date',
            'total_units',
            'project_status',
            'price_segment',
            'dataset_version',
            'synthetic_marker',
          ],
          conflict: 'ON CONFLICT (org_id, project_external_id) DO NOTHING',
        },
      ),
      zones: await importFiles(
        sql,
        'zones',
        single('dim_zones.csv'),
        'zone',
        orgId,
        manifest.dataset_version,
        batchSize,
        (row) => [
          orgId,
          row.zone_external_id,
          row.zone_name,
          row.project_external_id,
          integer(row.zone_sequence, 'zone_sequence'),
          integer(row.building_block_count, 'building_block_count'),
          integer(row.total_units, 'total_units'),
          row.dataset_version,
          row.synthetic_marker,
        ],
        {
          table: 'public.zones',
          columns: [
            'org_id',
            'zone_external_id',
            'zone_name',
            'project_external_id',
            'zone_sequence',
            'building_block_count',
            'total_units',
            'dataset_version',
            'synthetic_marker',
          ],
          conflict: 'ON CONFLICT (org_id, zone_external_id) DO NOTHING',
        },
      ),
      units: await importFiles(
        sql,
        'units',
        single('dim_units.csv'),
        'unit',
        orgId,
        manifest.dataset_version,
        batchSize,
        (row) => [
          row.org_id,
          row.unit_external_id,
          row.unit_code,
          row.market_external_id,
          row.project_external_id,
          row.zone_external_id,
          row.unit_type,
          emptyToNull(row.area_sqm),
          nullableInteger(row.bedrooms, 'bedrooms'),
          integer(row.floor_number, 'floor_number'),
          row.building_block,
          row.view_type,
          row.orientation,
          emptyToNull(row.initial_list_price),
          row.currency,
          row.launch_date,
          row.dataset_version,
          row.synthetic_marker,
        ],
        {
          table: 'public.units',
          columns: [
            'org_id',
            'unit_external_id',
            'unit_code',
            'market_external_id',
            'project_external_id',
            'zone_external_id',
            'unit_type',
            'area_sqm',
            'bedrooms',
            'floor_number',
            'building_block',
            'view_type',
            'orientation',
            'initial_list_price',
            'currency',
            'launch_date',
            'dataset_version',
            'synthetic_marker',
          ],
          conflict: 'ON CONFLICT (org_id, unit_external_id) DO NOTHING',
        },
      ),
      inventorySnapshots: await importFiles(
        sql,
        'inventory snapshots',
        inventoryFiles,
        'inventory',
        orgId,
        manifest.dataset_version,
        batchSize,
        (row) => {
          const payload = {
            org_id: row.org_id,
            snapshot_id: row.snapshot_id,
            import_id: row.import_id,
            snapshot_date: row.snapshot_date,
            market_external_id: row.market_external_id,
            market_name: row.market_name,
            project_external_id: row.project_external_id,
            project_name: row.project_name,
            zone_external_id: row.zone_external_id,
            zone_name: row.zone_name,
            unit_external_id: row.unit_external_id,
            unit_code: row.unit_code,
            unit_type: row.unit_type,
            area_sqm: emptyToNull(row.area_sqm),
            list_price: emptyToNull(row.list_price),
            currency: row.currency,
            status: row.status,
            available_since: emptyToNull(row.available_since),
            sold_at: emptyToNull(row.sold_at),
            bedrooms: nullableInteger(row.bedrooms, 'bedrooms'),
          };
          return [
            row.org_id,
            row.snapshot_id,
            row.import_id,
            row.unit_external_id,
            row.snapshot_date,
            row.project_external_id,
            row.zone_external_id,
            JSON.stringify(payload),
            row.country_code,
            row.market_external_id,
            row.market_name,
            row.project_name,
            row.zone_name,
            row.unit_code,
            row.unit_type,
            row.currency,
            integer(row.floor_number, 'floor_number'),
            row.building_block,
            row.view_type,
            row.orientation,
            row.handover_status,
            row.sales_channel,
            row.source_system,
            row.batch_id,
            row.dataset_version,
            row.synthetic_marker,
          ];
        },
        {
          table: 'public.snapshots',
          columns: [
            'org_id',
            'id',
            'import_id',
            'unit_external_id',
            'snapshot_date',
            'project_external_id',
            'zone_external_id',
            'payload',
            'country_code',
            'market_external_id',
            'market_name',
            'project_name',
            'zone_name',
            'unit_code',
            'unit_type',
            'currency',
            'floor_number',
            'building_block',
            'view_type',
            'orientation',
            'handover_status',
            'sales_channel',
            'source_system',
            'batch_id',
            'dataset_version',
            'synthetic_marker',
          ],
          conflict: 'ON CONFLICT (org_id, id) DO NOTHING',
        },
      ),
      transactions: await importFiles(
        sql,
        'transactions',
        await factFiles('fact_transaction', 4),
        'transaction',
        orgId,
        manifest.dataset_version,
        batchSize,
        (row) => [
          row.org_id,
          row.transaction_id,
          row.unit_external_id,
          row.project_external_id,
          row.zone_external_id,
          row.transaction_date,
          row.transaction_type,
          row.transaction_status,
          row.currency,
          row.gross_amount,
          row.discount_amount,
          row.net_amount,
          row.payment_method,
          row.sales_channel,
          row.customer_segment,
          row.agent_external_id,
          row.contract_type,
          emptyToNull(row.cancellation_reason),
          row.dataset_version,
          row.synthetic_marker,
        ],
        {
          table: 'public.inventory_transactions',
          columns: [
            'org_id',
            'transaction_id',
            'unit_external_id',
            'project_external_id',
            'zone_external_id',
            'transaction_date',
            'transaction_type',
            'transaction_status',
            'currency',
            'gross_amount',
            'discount_amount',
            'net_amount',
            'payment_method',
            'sales_channel',
            'customer_segment',
            'agent_external_id',
            'contract_type',
            'cancellation_reason',
            'dataset_version',
            'synthetic_marker',
          ],
          conflict: 'ON CONFLICT (org_id, transaction_id) DO NOTHING',
        },
      ),
      priceHistory: await importFiles(
        sql,
        'price history',
        await factFiles('fact_price_history', 6),
        'priceHistory',
        orgId,
        manifest.dataset_version,
        batchSize,
        (row) => [
          row.org_id,
          row.price_history_id,
          row.unit_external_id,
          row.project_external_id,
          row.effective_date,
          emptyToNull(row.previous_price),
          row.new_price,
          row.currency,
          emptyToNull(row.change_percent),
          row.change_reason,
          row.approved_by,
          row.dataset_version,
          row.synthetic_marker,
        ],
        {
          table: 'public.unit_price_history',
          columns: [
            'org_id',
            'price_history_id',
            'unit_external_id',
            'project_external_id',
            'effective_date',
            'previous_price',
            'new_price',
            'currency',
            'change_percent',
            'change_reason',
            'approved_by',
            'dataset_version',
            'synthetic_marker',
          ],
          conflict: 'ON CONFLICT (org_id, price_history_id) DO NOTHING',
        },
      ),
      reservations: await importFiles(
        sql,
        'reservations',
        await factFiles('fact_reservation', 2),
        'reservation',
        orgId,
        manifest.dataset_version,
        batchSize,
        (row) => [
          row.org_id,
          row.reservation_id,
          row.unit_external_id,
          row.project_external_id,
          row.reservation_date,
          row.expiry_date,
          row.status,
          row.deposit_amount,
          row.currency,
          row.sales_channel,
          row.customer_segment,
          emptyToNull(row.cancellation_reason),
          row.dataset_version,
          row.synthetic_marker,
        ],
        {
          table: 'public.unit_reservations',
          columns: [
            'org_id',
            'reservation_id',
            'unit_external_id',
            'project_external_id',
            'reservation_date',
            'expiry_date',
            'status',
            'deposit_amount',
            'currency',
            'sales_channel',
            'customer_segment',
            'cancellation_reason',
            'dataset_version',
            'synthetic_marker',
          ],
          conflict: 'ON CONFLICT (org_id, reservation_id) DO NOTHING',
        },
      ),
    };

    if (
      imported.markets !== manifest.totals.markets ||
      imported.projects !== manifest.totals.projects ||
      imported.zones !== manifest.totals.zones ||
      imported.units !== manifest.totals.dim_units ||
      imported.inventorySnapshots !== manifest.totals.fact_inventory_snapshot ||
      imported.transactions !== manifest.totals.fact_transaction ||
      imported.priceHistory !== manifest.totals.fact_price_history ||
      imported.reservations !== manifest.totals.fact_reservation
    )
      throw new Error('processed source row counts do not match manifest');
    console.info('Import completed; run validate-import.ts to query the warehouse checks.');
  } finally {
    await sql.end({ timeout: 10 });
  }
}

void main().catch((error: unknown) => {
  console.error(
    `Mock data import failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});

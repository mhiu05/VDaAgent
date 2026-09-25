import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import {
  createRepository,
  type Repository,
  type StorageUploader,
} from '../../packages/db/src/index.js';
import type { Driver, Row } from '../../packages/db/src/driver.js';

export const TEST_ORGS = {
  alpha: '10000000-0000-4000-8000-000000000001',
  beta: '10000000-0000-4000-8000-000000000002',
} as const;

export const TEST_USERS = {
  owner: '20000000-0000-4000-8000-000000000001',
  analyst: '20000000-0000-4000-8000-000000000002',
  viewer: '20000000-0000-4000-8000-000000000003',
  beta: '20000000-0000-4000-8000-000000000004',
} as const;

export type StoredObject = Parameters<StorageUploader['upload']>[0];

const supabaseShims = `
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  GRANT USAGE ON SCHEMA auth TO authenticated;
  CREATE SCHEMA storage;
  CREATE TABLE storage.objects(id uuid PRIMARY KEY, name text, bucket_id text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA storage TO authenticated;
  GRANT SELECT ON storage.objects TO authenticated;
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT string_to_array($1, '/')
  $$;
`;

export function pgliteDriver(pg: PGlite): Driver {
  const wrap = (db: Pick<PGlite, 'query'>): Driver => ({
    kind: 'postgres',
    query: async (sql, params = []) => (await db.query(sql, params)).rows as Row[],
    transaction: async (fn) => fn(wrap(db)),
    close: async () => {},
  });
  return {
    ...wrap(pg),
    transaction: async (fn) => pg.transaction((tx) => fn(wrap(tx))),
  };
}

export async function createLegacyTestDatabase() {
  const pg = new PGlite();
  await pg.exec(supabaseShims);
  await pg.exec(
    await readFile('src/backend/supabase/migrations/20260919045733_inventory_mvp.sql', 'utf8'),
  );
  await pg.exec(
    await readFile('src/backend/supabase/migrations/20260920170143_agent_chat.sql', 'utf8'),
  );
  return pg;
}

export async function createTestDatabase() {
  const pg = await createLegacyTestDatabase();
  await upgradeTestDatabase(pg);
  return pg;
}

export async function upgradeTestDatabase(pg: PGlite) {
  await pg.exec(
    await readFile(
      'src/backend/supabase/migrations/20260921101524_agent_workflow_persistence.sql',
      'utf8',
    ),
  );
  await pg.exec(
    await readFile(
      'src/backend/supabase/migrations/20260922130000_agent_stage_messages.sql',
      'utf8',
    ),
  );
  await pg.exec(
    await readFile(
      'src/backend/supabase/migrations/20260924120000_durable_agent_execution.sql',
      'utf8',
    ),
  );
  await pg.exec(
    await readFile(
      'src/backend/supabase/migrations/20260925082316_guard_run_workflow_version.sql',
      'utf8',
    ),
  );
}

export async function createTestRepository(): Promise<{
  pg: PGlite;
  repo: Repository;
  uploads: StoredObject[];
}> {
  const pg = await createTestDatabase();
  const uploads: StoredObject[] = [];
  const storage: StorageUploader = { upload: async (input) => void uploads.push(input) };
  const repo = await createRepository({
    driver: pgliteDriver(pg),
    storage,
    seedTestData: true,
  });
  return { pg, repo, uploads };
}

import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
describe('PostgreSQL schema and RLS (PGlite, without Supabase services)', () => {
  it('applies canonical DDL and enforces real Postgres tenant reads and least privilege', async () => {
    const db = new PGlite();
    try {
      await db.exec(
        `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY,name text,bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT ON storage.objects TO authenticated; CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;`,
      );
      await db.exec(await readFile('src/backend/supabase/schemas/001_inventory.sql', 'utf8'));
      await db.exec(await readFile('src/backend/supabase/schemas/005_agent_chat.sql', 'utf8'));
      await db.exec(
        `INSERT INTO organizations(org_id,name) VALUES('10000000-0000-4000-8000-000000000001','Alpha'),('10000000-0000-4000-8000-000000000002','Beta'); INSERT INTO organization_members(org_id,user_id,role) VALUES('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','viewer'); INSERT INTO imports(org_id,id,file_hash,payload) VALUES('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','alpha','{"storage_path":"10000000-0000-4000-8000-000000000001/file.csv"}'),('10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','beta','{"storage_path":"10000000-0000-4000-8000-000000000002/file.csv"}'); INSERT INTO storage.objects(id,name,bucket_id) VALUES('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001/file.csv','source-imports'),('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002/file.csv','source-imports');`,
      );
      await db.exec(
        `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false);`,
      );
      expect((await db.query('SELECT * FROM organizations')).rows).toHaveLength(1);
      expect((await db.query('SELECT * FROM imports')).rows).toHaveLength(1);
      expect((await db.query('SELECT * FROM conversations')).rows).toHaveLength(0);
      expect((await db.query('SELECT * FROM storage.objects')).rows).toHaveLength(1);
      await expect(db.exec("UPDATE organization_members SET role='owner'")).rejects.toThrow(
        'permission denied',
      );
      await expect(
        db.exec(
          "INSERT INTO imports(org_id,id,file_hash,payload) VALUES('10000000-0000-4000-8000-000000000002','forged','forged','{}')",
        ),
      ).rejects.toThrow('permission denied');
      await expect(
        db.exec(
          "INSERT INTO conversations(org_id,id,created_by,kind,title) VALUES('10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','interactive','forged')",
        ),
      ).rejects.toThrow('permission denied');
      await db.exec(`RESET ROLE; DELETE FROM organization_members; SET ROLE authenticated;`);
      expect((await db.query('SELECT * FROM imports')).rows).toHaveLength(0);
      expect((await db.query('SELECT * FROM storage.objects')).rows).toHaveLength(0);
      await db.exec('RESET ROLE');
      await expect(db.exec("UPDATE imports SET file_hash='changed'")).rejects.toThrow(
        'immutable lineage record',
      );
    } finally {
      await db.close();
    }
  }, 30000);
});

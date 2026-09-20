import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { TEST_ORGS, TEST_USERS, syntheticRows } from './seed.js';
const quote = (v: unknown) => `'${String(v).replaceAll("'", "''")}'`;
const statements = [
  `-- Synthetic local test accounts. Password: local-test-only. Never use outside local testing.`,
  `INSERT INTO storage.buckets(id,name,public) VALUES ('source-imports','source-imports',false) ON CONFLICT(id) DO NOTHING;`,
  `INSERT INTO storage.buckets(id,name,public) VALUES ('report-exports','report-exports',false) ON CONFLICT(id) DO NOTHING;`,
];
for (const [role, id] of Object.entries(TEST_USERS)) {
  const email = `${role}@vda.example.test`;
  statements.push(
    `INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change) VALUES ('00000000-0000-0000-0000-000000000000',${quote(id)},'authenticated','authenticated',${quote(email)},extensions.crypt('local-test-only',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','') ON CONFLICT(id) DO NOTHING;`,
  );
  statements.push(
    `INSERT INTO auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at) VALUES (${quote(id)},${quote(id)},${quote(id)},${quote(JSON.stringify({ sub: id, email, email_verified: true, phone_verified: false }))}::jsonb,'email',now(),now()) ON CONFLICT(provider_id,provider) DO NOTHING;`,
  );
}
for (const [name, org] of Object.entries(TEST_ORGS)) {
  statements.push(
    `INSERT INTO organizations(org_id,name) VALUES(${quote(org)},${quote(`Workspace ${name}`)}) ON CONFLICT DO NOTHING;`,
  );
  const owner = name === 'alpha' ? TEST_USERS.owner : TEST_USERS.beta;
  for (const role of name === 'alpha'
    ? (['owner', 'analyst', 'viewer'] as const)
    : (['owner'] as const)) {
    const user = name === 'alpha' ? TEST_USERS[role] : owner;
    statements.push(
      `INSERT INTO organization_members(org_id,user_id,role) VALUES(${quote(org)},${quote(user)},${quote(role)}) ON CONFLICT DO NOTHING;`,
    );
  }
  const importId =
    name === 'alpha'
      ? '30000000-0000-4000-8000-000000000001'
      : '30000000-0000-4000-8000-000000000002';
  const rows = syntheticRows();
  const manifest = {
    import_id: importId,
    org_id: org,
    created_by: owner,
    created_at: '2026-09-19T00:00:00.000Z',
    source_name: 'synthetic-seed.csv',
    file_hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    row_count: rows.length,
    storage_path: null,
    schema_version: 'csv-v1',
    provisional: true,
  };
  statements.push(
    `INSERT INTO imports(org_id,id,file_hash,payload) VALUES(${quote(org)},${quote(importId)},${quote(manifest.file_hash)},${quote(JSON.stringify(manifest))}::jsonb) ON CONFLICT DO NOTHING;`,
  );
  for (const [index, row] of rows.entries()) {
    const id = `40000000-0000-4000-8000-${String((name === 'alpha' ? 0 : 100) + index + 1).padStart(12, '0')}`;
    const snapshot = { ...row, org_id: org, import_id: importId, snapshot_id: id };
    statements.push(
      `INSERT INTO snapshots(org_id,id,import_id,unit_external_id,snapshot_date,project_external_id,zone_external_id,payload) VALUES(${[org, id, importId, row.unit_external_id, row.snapshot_date, row.project_external_id, row.zone_external_id, JSON.stringify(snapshot)].map(quote).join(',')}) ON CONFLICT DO NOTHING;`,
    );
  }
}
await writeFile('src/backend/supabase/seed.sql', statements.join('\n') + '\n');

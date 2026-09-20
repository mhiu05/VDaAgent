import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter((e) => !['node_modules', '.next', '.turbo', 'schema'].includes(e.name))
        .map((e) =>
          e.isDirectory() ? files(resolve(dir, e.name)) : Promise.resolve([resolve(dir, e.name)]),
        ),
    )
  ).flat();
}
const failures: string[] = [];
for (const dir of ['src'])
  for (const file of (await files(dir)).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))) {
    const text = await readFile(file, 'utf8');
    if (
      /^['"]use client['"];?/m.test(text) &&
      /SUPABASE_SECRET_KEY|SUPABASE_DB_URL|GEMINI_API_KEY|OPENAI_API_KEY|@vda\/(db|agents|config|domain)/.test(
        text,
      )
    )
      failures.push(`${file}: server dependency in client`);
    if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}|sb_secret_[A-Za-z0-9_-]{20,}/.test(text))
      failures.push(`${file}: possible credential`);
  }
const schema = await readFile('src/backend/supabase/schemas/001_inventory.sql', 'utf8');
const migration = await readFile(
  'src/backend/supabase/migrations/20260919045733_inventory_mvp.sql',
  'utf8',
);
if (schema !== migration) failures.push('Initial declarative schema and migration drift');
for (const match of schema.matchAll(/CREATE TABLE (\w+)\(/g))
  if (!schema.includes(`ALTER TABLE public.${match[1]} ENABLE ROW LEVEL SECURITY`))
    failures.push(`${match[1]}: RLS missing`);
const schemaDir = 'src/backend/supabase/schemas';
const migrationDir = 'src/backend/supabase/migrations';
const schemaFiles = await readdir(schemaDir);
const migrationFiles = await readdir(migrationDir);
const declarativeSchema = await Promise.all(
  schemaFiles
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFile(resolve(schemaDir, file), 'utf8')),
).then((files) => files.join('\n'));
const agentMigration = migrationFiles.find((file) => /_agent_chat\.sql$/.test(file));
if (!agentMigration) failures.push('Agent Chat migration missing');
const agentMigrationSql = agentMigration
  ? await readFile(resolve(migrationDir, agentMigration), 'utf8')
  : '';
for (const required of [
  'ADD COLUMN kind TEXT',
  'ADD COLUMN client_turn_id TEXT',
  'CREATE INDEX conversations_interactive_updated',
  'CREATE INDEX messages_conversation_page',
  'CREATE UNIQUE INDEX messages_turn_role_unique',
  'CREATE UNIQUE INDEX messages_run_role_unique',
])
  if (!declarativeSchema.includes(required))
    failures.push(`Agent Chat declarative schema missing: ${required}`);
for (const table of ['conversations', 'messages']) {
  if (!declarativeSchema.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`))
    failures.push(`${table}: Agent Chat RLS missing`);
  if (!declarativeSchema.includes(`REVOKE ALL ON public.${table} FROM PUBLIC,anon,authenticated`))
    failures.push(`${table}: direct authenticated writes not revoked`);
  if (!declarativeSchema.includes(`GRANT SELECT ON public.${table} TO authenticated`))
    failures.push(`${table}: authenticated read grant missing`);
}
if (agentMigration && !agentMigrationSql.includes('UPDATE public.messages'))
  failures.push('Agent Chat migration lacks legacy message backfill');
const env = await readFile('.env.example', 'utf8');
for (const line of env.split('\n'))
  if (/^NEXT_PUBLIC_.*(?:SECRET|PASSWORD|DB_URL|API_KEY)=.+/.test(line))
    failures.push('Public secret env setting');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Client/server boundary, credential patterns, schema parity and RLS coverage passed.',
  );

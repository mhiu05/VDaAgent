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
const requireSql = (sql: string, subject: string, checks: ReadonlyArray<[string, string]>) => {
  for (const [description, fragment] of checks)
    if (!sql.includes(fragment)) failures.push(`${subject}: missing ${description}`);
};
const requirePattern = (sql: string, subject: string, checks: ReadonlyArray<[string, RegExp]>) => {
  for (const [description, pattern] of checks)
    if (!pattern.test(sql)) failures.push(`${subject}: missing ${description}`);
};
const readSchema = async (name: string, subject: string) => {
  if (!schemaFiles.includes(name)) {
    failures.push(`${subject}: declarative schema missing`);
    return '';
  }
  return readFile(resolve(schemaDir, name), 'utf8');
};
const readMigration = async (pattern: RegExp, subject: string) => {
  const matches = migrationFiles.filter((file) => pattern.test(file));
  if (matches.length !== 1) {
    failures.push(`${subject}: migration missing or ambiguous`);
    return '';
  }
  return readFile(resolve(migrationDir, matches[0]), 'utf8');
};
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
const workflowSchemaSubject = 'Agent workflow declarative schema (006)';
const stageMessagesSchemaSubject = 'Agent stage messages declarative schema (007)';
const workflowMigrationSubject = 'Agent workflow migration (006)';
const stageMessagesMigrationSubject = 'Agent stage messages migration (007)';
const [workflowSchema, stageMessagesSchema, workflowMigrationSql, stageMessagesMigrationSql] =
  await Promise.all([
    readSchema('006_agent_workflow_persistence.sql', workflowSchemaSubject),
    readSchema('007_agent_stage_messages.sql', stageMessagesSchemaSubject),
    readMigration(/_agent_workflow_persistence\.sql$/, workflowMigrationSubject),
    readMigration(/_agent_stage_messages\.sql$/, stageMessagesMigrationSubject),
  ]);

const artifactKeyChecks: ReadonlyArray<[string, string]> = [
  ['artifact_key column', 'artifact_key TEXT'],
  ['legacy kind uniqueness removal', 'DROP CONSTRAINT IF EXISTS artifacts_org_id_run_id_kind_key'],
  ['artifact key shape constraint', 'artifact_key = btrim(artifact_key)'],
  ['artifact key length constraint', 'char_length(artifact_key) BETWEEN 1 AND 160'],
  ['canonical report key constraint', `artifact_key <> 'report' OR kind = 'report'`],
  ['per-run artifact key uniqueness', 'UNIQUE (org_id, run_id, artifact_key)'],
  ['legacy artifact key assignment', 'NEW.artifact_key := NEW.kind'],
  ['legacy artifact key trigger', 'CREATE TRIGGER artifacts_assign_legacy_key'],
  [
    'legacy artifact key function revocation',
    'REVOKE ALL ON FUNCTION private.assign_legacy_artifact_key() FROM PUBLIC, anon, authenticated',
  ],
];
const senderChecks: ReadonlyArray<[string, string]> = [
  ['sender_agent column', 'sender_agent TEXT'],
  ['nullable legacy sender allowance', 'sender_agent IS NULL'],
  ['assistant-only attributed sender constraint', `role = 'assistant'`],
  ['agent sender allowlist', 'sender_agent IN ('],
  ['coordinator sender allowlist entry', `'coordinator'`],
  ['data sender allowlist entry', `'data'`],
  ['comparison sender allowlist entry', `'comparison'`],
  ['chart sender allowlist entry', `'chart'`],
  ['analyst sender allowlist entry', `'analyst'`],
  ['insight sender allowlist entry', `'insight'`],
  ['report sender allowlist entry', `'report'`],
  ['reviewer sender allowlist entry', `'reviewer'`],
  ['attributed sender pagination index', 'messages_run_sender_agent_page'],
];
const tableAccessChecks = (table: 'artifacts' | 'messages'): ReadonlyArray<[string, string]> => [
  ['RLS enabled', `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`],
  [
    'authenticated direct writes revoked',
    `REVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated`,
  ],
  ['authenticated read grant', `GRANT SELECT ON public.${table} TO authenticated`],
  ['service role grant', `GRANT ALL ON public.${table} TO service_role`],
];
const privateWorkflowVisibilityChecks: ReadonlyArray<[string, string]> = [
  [
    'draft and review artifact kinds are private',
    `artifacts.kind NOT IN ('report_draft','review_result')`,
  ],
  ['owner and analyst private artifact access', `m.role IN ('owner','analyst')`],
  ['private lineage function', 'CREATE OR REPLACE FUNCTION private.can_read_artifact_lineage'],
  ['private lineage security definer', 'SECURITY DEFINER'],
  [
    'private lineage function revocation',
    'REVOKE ALL ON FUNCTION private.can_read_artifact_lineage(TEXT,TEXT) FROM PUBLIC, anon, authenticated',
  ],
  [
    'private lineage function grant',
    'GRANT EXECUTE ON FUNCTION private.can_read_artifact_lineage(TEXT,TEXT) TO authenticated, service_role',
  ],
  [
    'artifact input artifact lineage policy',
    'private.can_read_artifact_lineage(artifact_inputs.org_id,artifact_inputs.artifact_id)',
  ],
  [
    'artifact input source lineage policy',
    'private.can_read_artifact_lineage(artifact_inputs.org_id,artifact_inputs.input_id)',
  ],
  [
    'artifact snapshot lineage policy',
    'private.can_read_artifact_lineage(artifact_snapshots.org_id,artifact_snapshots.artifact_id)',
  ],
  [
    'artifact source lineage policy',
    'private.can_read_artifact_lineage(artifact_sources.org_id,artifact_sources.artifact_id)',
  ],
  [
    'validation lineage policy',
    'private.can_read_artifact_lineage(validations.org_id,validations.id)',
  ],
];
for (const [sql, subject] of [
  [workflowSchema, workflowSchemaSubject],
  [workflowMigrationSql, workflowMigrationSubject],
] as const) {
  requireSql(sql, subject, artifactKeyChecks);
  requireSql(sql, subject, senderChecks);
  requireSql(sql, subject, tableAccessChecks('artifacts'));
  requireSql(sql, subject, tableAccessChecks('messages'));
  requireSql(sql, subject, privateWorkflowVisibilityChecks);
  requirePattern(sql, subject, [
    ['hardened private function search path', /SET search_path\s*=\s*''/],
    [
      'attributed sender pagination index',
      /CREATE INDEX(?: IF NOT EXISTS)? messages_run_sender_agent_page/,
    ],
  ]);
}
requireSql(workflowSchema, workflowSchemaSubject, [
  ['non-null artifact key', 'ADD COLUMN artifact_key TEXT NOT NULL'],
]);
requireSql(workflowMigrationSql, workflowMigrationSubject, [
  ['legacy artifact key backfill', 'SET artifact_key = kind'],
  ['non-null artifact key after backfill', 'ALTER COLUMN artifact_key SET NOT NULL'],
  ['restored artifact immutability trigger', 'CREATE TRIGGER immutable_artifacts'],
]);
const stageMessageIndexPatterns: ReadonlyArray<[string, RegExp]> = [
  ['legacy run-role uniqueness removal', /DROP INDEX IF EXISTS public\.messages_run_role_unique/],
  [
    'one initiating assistant message per run',
    /CREATE UNIQUE INDEX(?: IF NOT EXISTS)? messages_initiating_assistant_run_unique/,
  ],
  ['initiating message null sender fence', /role = 'assistant'\s+AND sender_agent IS NULL/],
  [
    'one checkpoint per specialized sender per run',
    /CREATE UNIQUE INDEX(?: IF NOT EXISTS)? messages_run_sender_agent_unique/,
  ],
  ['specialized sender non-null fence', /sender_agent IS NOT NULL/],
];
for (const [sql, subject] of [
  [stageMessagesSchema, stageMessagesSchemaSubject],
  [stageMessagesMigrationSql, stageMessagesMigrationSubject],
] as const)
  requirePattern(sql, subject, stageMessageIndexPatterns);
const env = await readFile('.env.example', 'utf8');
for (const line of env.split('\n'))
  if (/^NEXT_PUBLIC_.*(?:SECRET|PASSWORD|DB_URL|API_KEY)=.+/.test(line))
    failures.push('Public secret env setting');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Client/server boundary, credential patterns, schema parity, agent-workflow guards and RLS coverage passed.',
  );

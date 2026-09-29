import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
const test = fileURLToPath(new URL('../tests/db/tenant_rls.test.sql', import.meta.url));
const project = fileURLToPath(new URL('../src/backend/', import.meta.url));

const result = spawnSync(
  process.execPath,
  [cli, 'test', 'db', '--local', '--workdir', project, test],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

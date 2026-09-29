import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = fileURLToPath(new URL('../src/frontend/', import.meta.url));
const project = fileURLToPath(new URL('../src/backend/', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
const playwright = fileURLToPath(
  new URL('../node_modules/@playwright/test/cli.js', import.meta.url),
);
const guard = fileURLToPath(new URL('../tests/fixtures/local-env-guard.mjs', import.meta.url));
const provider = fileURLToPath(new URL('../tests/fixtures/gemini-adapter.mjs', import.meta.url));
const nextCli = fileURLToPath(
  new URL('../src/frontend/node_modules/next/dist/bin/next', import.meta.url),
);
const worker = fileURLToPath(new URL('../src/backend/worker/index.ts', import.meta.url));
const nextEnv = fileURLToPath(new URL('../src/frontend/next-env.d.ts', import.meta.url));
const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

function localUrl(value) {
  try {
    return localHosts.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

function localSupabase() {
  const result = spawnSync(
    process.execPath,
    [cli, 'status', '--output', 'env', '--workdir', project],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) throw new Error('Start the disposable local Supabase stack before E2E.');
  const values = Object.fromEntries(
    result.stdout.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (!match) return [];
      const value = match[2].replace(/^"|"$/g, '');
      return [[match[1], value]];
    }),
  );
  if (!localUrl(values.DB_URL) || !localUrl(values.API_URL))
    throw new Error('E2E requires local Supabase DB_URL and API_URL.');
  for (const key of ['PUBLISHABLE_KEY', 'SECRET_KEY'])
    if (!values[key]) throw new Error(`Local Supabase status is missing ${key}.`);
  return values;
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

function launch(args, cwd, env) {
  return spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
}

async function waitForWeb(child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error('E2E web server exited before becoming ready.');
    try {
      const response = await fetch('http://127.0.0.1:3100/api/setup', {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      /* Wait for startup. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('E2E web server did not become ready.');
}

const local = localSupabase();
const durable =
  process.argv.includes('--durable') || process.env.E2E_DURABLE_AGENT_EXECUTION === 'true';
const playwrightArgs = process.argv.slice(2).filter((arg) => arg !== '--durable');
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: local.SECRET_KEY,
  SUPABASE_DB_URL: local.DB_URL,
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  LLM_PRIMARY_PROVIDER: 'gemini',
  LLM_FALLBACK_PROVIDER: 'openai',
  AGENT_LLM_PRIMARY_PROVIDER: 'gemini',
  AGENT_LLM_FALLBACK_PROVIDER: 'openai',
  GEMINI_API_KEY: 'local-e2e-fixture',
  GEMINI_MODEL: 'fixture',
  OPENAI_API_KEY: 'local-e2e-fixture',
  OPENAI_MODEL: 'fixture',
  DURABLE_AGENT_EXECUTION_ENABLED: String(durable),
  AGENT_SSE_ENABLED: 'true',
  NEXT_DIST_DIR: '.next-e2e',
  E2E_DURABLE_AGENT_EXECUTION: String(durable),
};

const preloads = ['--import', pathToFileURL(guard).href, '--import', pathToFileURL(provider).href];
let web;
let background;
const nextEnvBeforeBuild = readFileSync(nextEnv);
try {
  const build = launch([nextCli, 'build'], frontend, env);
  if ((await waitForExit(build)) !== 0) throw new Error('E2E web build failed.');
  web = launch(
    [...preloads, nextCli, 'start', '--hostname', '127.0.0.1', '--port', '3100'],
    frontend,
    env,
  );
  await waitForWeb(web);
  background = launch([...preloads, '--import', 'tsx', worker], root, env);
  const tests = launch(
    [playwright, 'test', '--config', 'tests/playwright.config.ts', ...playwrightArgs],
    root,
    env,
  );
  process.exitCode = await waitForExit(tests);
} finally {
  background?.kill();
  web?.kill();
  writeFileSync(nextEnv, nextEnvBeforeBuild);
}

import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
function supabase(args) {
  const executable = process.env.npm_execpath ? process.execPath : pnpm;
  const commandArgs = [
    ...(process.env.npm_execpath ? [process.env.npm_execpath] : []),
    'exec',
    'supabase',
    '--workdir',
    'src/backend',
    ...args,
  ];
  const result = spawnSync(executable, commandArgs, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Unable to prepare local Supabase (${args.join(' ')}).`);
  return result.stdout;
}
if (process.env.E2E_PRODUCTION) throw new Error('E2E must use the local Supabase test stack.');
supabase(['start']);
supabase(['db', 'reset', '--local']);
const status = new Map(
  supabase(['status', '--output', 'env'])
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      return match ? [[match[1], match[2].replace(/^(["'])(.*)\1$/, '$2')]] : [];
    }),
);
const required = (...names) => {
  for (const name of names) {
    const value = status.get(name);
    if (value) return value;
  }
  throw new Error(`Local Supabase did not provide ${names.join(' or ')}.`);
};
const {
  LLM_MODE: _legacyLlmMode,
  AGENT_WORKFLOW_ENABLED: _obsoleteWorkflowFlag,
  ...inheritedEnv
} = process.env;
const durableAgentExecutionEnabled = process.env.E2E_DURABLE_AGENT_EXECUTION === 'true';
const env = {
  ...inheritedEnv,
  APP_MODE: 'supabase',
  DEVELOPMENT_ROLE_BYPASS: 'false',
  LLM_PRIMARY_PROVIDER: 'gemini',
  LLM_FALLBACK_PROVIDER: 'openai',
  GEMINI_API_KEY: 'e2e-gemini-key',
  GEMINI_MODEL: 'gemini-test',
  OPENAI_API_KEY: 'e2e-openai-key',
  OPENAI_MODEL: 'gpt-test',
  NEXT_PUBLIC_SUPABASE_URL: required('API_URL', 'SUPABASE_URL'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: required('PUBLISHABLE_KEY', 'ANON_KEY'),
  SUPABASE_SECRET_KEY: required('SECRET_KEY', 'SERVICE_ROLE_KEY'),
  SUPABASE_DB_URL: required('DB_URL'),
  NEXT_DIST_DIR: '.next-e2e',
  NEXT_TELEMETRY_DISABLED: '1',
  TURBO_TELEMETRY_DISABLED: '1',
  GROK_RUNTIME_ENABLED: 'true',
  GROK_WORKSPACE_ENABLED: 'true',
  GROK_SSE_ENABLED: process.env.E2E_GROK_SSE === 'true' ? 'true' : 'false',
  // Default E2E exercises Runtime over JSON; a separate variant enables jobs.
  DURABLE_AGENT_EXECUTION_ENABLED: durableAgentExecutionEnabled ? 'true' : 'false',
};
const children = [
  spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(resolve(repositoryRoot, 'src/backend/tests/fixtures/gemini-e2e-adapter.mjs'))
        .href,
      resolve(repositoryRoot, 'src/frontend/node_modules/next/dist/bin/next'),
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3100',
    ],
    { cwd: resolve(repositoryRoot, 'src/frontend'), env, stdio: 'inherit', windowsHide: true },
  ),
  spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--import',
      pathToFileURL(resolve(repositoryRoot, 'src/backend/tests/fixtures/gemini-e2e-adapter.mjs'))
        .href,
      resolve(repositoryRoot, 'src/backend/worker/src/index.ts'),
    ],
    { cwd: repositoryRoot, env, stdio: 'inherit', windowsHide: true },
  ),
];
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
process.on('exit', close);
for (const child of children)
  child.on('exit', (code) => {
    close();
    process.exitCode = code ?? 0;
  });

import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const sourceRoot = resolve('src');
const frontendRoot = resolve('src/frontend/src');
const packageRoot = resolve('src/backend/packages');
const workerRoot = resolve('src/backend/worker/src');
const allowedPackages: Record<string, readonly string[]> = {
  contracts: [],
  config: [],
  semantic: ['contracts'],
  domain: ['contracts', 'semantic'],
  db: ['contracts', 'domain'],
  agents: ['contracts', 'config', 'semantic', 'domain', 'db'],
  worker: ['contracts', 'config', 'semantic', 'domain', 'db', 'agents'],
};
const serverPackages = new Set(['db', 'agents', 'config', 'domain', 'semantic']);
const failures: string[] = [];
const imports = new Map<string, string[]>();

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter((entry) => !['node_modules', '.next', '.turbo'].includes(entry.name))
        .map((entry) => {
          const path = resolve(directory, entry.name);
          return entry.isDirectory() ? sourceFiles(path) : Promise.resolve([path]);
        }),
    )
  ).flat();
}

function packageName(path: string): string | null {
  if (path.startsWith(packageRoot + sep)) return relative(packageRoot, path).split(sep)[0];
  if (path.startsWith(workerRoot + sep)) return 'worker';
  return null;
}

function isBrowserPath(path: string): boolean {
  if (!path.startsWith(frontendRoot + sep)) return false;
  const within = relative(frontendRoot, path).split(sep);
  if (within[0] === 'server') return false;
  if (within[0] === 'app' && within[1] === 'api') return false;
  return ['app', 'components', 'features', 'lib'].includes(within[0]);
}

function isFrontendServerPath(path: string): boolean {
  if (!path.startsWith(frontendRoot + sep)) return false;
  const within = relative(frontendRoot, path).split(sep);
  return within[0] === 'server' || (within[0] === 'app' && within[1] === 'api');
}

function resolveSource(from: string, specifier: string, known: Set<string>): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')])
    if (known.has(candidate)) return candidate;
  return null;
}

const files = (await sourceFiles(sourceRoot)).filter(
  (path) => ['.ts', '.tsx'].includes(extname(path)) && !/\.test\.[cm]?tsx?$/.test(path),
);
const known = new Set(files);
for (const file of files) {
  const content = await readFile(file, 'utf8');
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const owner = packageName(file);
  const browser = isBrowserPath(file);
  const edges: string[] = [];
  for (const statement of source.statements) {
    const specifier =
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;
    if (!specifier) continue;
    const targetPackage = specifier.startsWith('@vda/') ? specifier.slice(5).split('/')[0] : null;
    const target = specifier.startsWith('.') ? resolveSource(file, specifier, known) : null;
    const targetOwner = target ? packageName(target) : targetPackage;
    const display = relative(resolve('.'), file);
    if (
      owner &&
      targetOwner &&
      owner !== targetOwner &&
      !allowedPackages[owner]?.includes(targetOwner)
    )
      failures.push(`${display}: ${specifier} violates ${owner} package dependencies`);
    if (
      browser &&
      ((targetOwner && serverPackages.has(targetOwner)) || (target && isFrontendServerPath(target)))
    )
      failures.push(`${display}: ${specifier} crosses the browser/server boundary`);
    const knownContractExport =
      file === resolve(packageRoot, 'contracts/src/export.ts') &&
      target === resolve(packageRoot, 'contracts/src/index.ts');
    if (
      owner &&
      target &&
      owner === targetOwner &&
      /[/\\]src[/\\]index\.ts$/.test(target) &&
      file !== target &&
      !knownContractExport
    )
      failures.push(`${display}: ${specifier} imports its package root`);
    if (target) edges.push(target);
  }
  imports.set(file, edges);
}

const active = new Set<string>();
const visited = new Set<string>();
const cycles = new Set<string>();
function visit(file: string, path: string[]): void {
  if (active.has(file)) {
    const cycle = path.slice(path.indexOf(file)).map((part) => relative(resolve('.'), part));
    cycles.add(cycle.join(' -> '));
    return;
  }
  if (visited.has(file)) return;
  active.add(file);
  for (const target of imports.get(file) ?? []) visit(target, [...path, target]);
  active.delete(file);
  visited.add(file);
}
for (const file of files) visit(file, [file]);
for (const cycle of cycles) {
  failures.push(`Dependency cycle: ${cycle}`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Architecture imports passed (${files.length} source files).`);

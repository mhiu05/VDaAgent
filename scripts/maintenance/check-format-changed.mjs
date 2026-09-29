import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getFileInfo } from 'prettier';

const root = fileURLToPath(new URL('../../', import.meta.url));

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'buffer' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const headHashes = new Set(
  git('ls-tree', '-r', '-z', 'HEAD')
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.match(/^[0-9]+ blob ([a-f0-9]{40})\t/)?.[1])
    .filter(Boolean),
);
const paths = git('ls-files', '--modified', '--others', '--exclude-standard', '-z')
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
const changed = [];
for (const path of paths) {
  const absolute = new URL(`../../${path.replaceAll('\\', '/')}`, import.meta.url);
  if (!existsSync(absolute)) continue;
  const hash = git('hash-object', '--', path).toString('utf8').trim();
  if (headHashes.has(hash)) continue;
  const info = await getFileInfo(fileURLToPath(absolute), { ignorePath: '.prettierignore' });
  if (!info.ignored && info.inferredParser) changed.push(path);
}

if (changed.length === 0) {
  process.stdout.write('No substantively changed files to format-check.\n');
  process.exit(0);
}
const prettier = fileURLToPath(
  new URL('../../node_modules/prettier/bin/prettier.cjs', import.meta.url),
);
const result = spawnSync(process.execPath, [prettier, '--check', ...changed], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);

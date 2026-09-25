import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(frontendRoot, 'src');
const scannedRoots = ['components', 'features', 'app'].map((name) => path.join(sourceRoot, name));
const colorLiteral = /#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})\b/gi;
const violations = [];

async function scan(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(target);
      continue;
    }
    if (!/\.(?:ts|tsx|css)$/.test(entry.name) || entry.name.includes('.test.')) continue;
    if (entry.name.endsWith('.css') && !entry.name.endsWith('.module.css')) continue;

    const source = await readFile(target, 'utf8');
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.includes('design-token-exception')) return;
      for (const match of line.matchAll(colorLiteral)) {
        violations.push(`${path.relative(frontendRoot, target)}:${index + 1}: ${match[0]}`);
      }
    });
  }
}

for (const directory of scannedRoots) await scan(directory);

if (violations.length) {
  console.error('Use semantic design tokens instead of raw color literals:');
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('No raw colors found in frontend components or feature styles.');
}

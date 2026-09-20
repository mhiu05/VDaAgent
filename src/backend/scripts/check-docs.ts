import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? files(resolve(dir, e.name)) : Promise.resolve([resolve(dir, e.name)]),
      ),
    )
  ).flat();
}
const failures: string[] = [];
let count = 0;
for (const file of (await files('docs')).filter((f) => f.endsWith('.md'))) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let link = match[1].split(/\s+"/)[0].replace(/^<|>$/g, '').split('#')[0];
    if (!link || /^(?:https?:|mailto:|app:)/.test(link)) continue;
    link = decodeURIComponent(link);
    if (link.includes('<') || link.includes('{')) continue;
    count++;
    try {
      await access(resolve(dirname(file), link));
    } catch {
      failures.push(`${file}: ${link}`);
    }
  }
}
for (const file of [
  'docs/26_Infrastructure_And_Deployment/Local_Setup.md',
  'docs/23_Testing/MVP_Validation.md',
  'docs/REQUIREMENT_TRACEABILITY.md',
]) {
  try {
    const text = await readFile(file, 'utf8');
    if (!/MVP|mvp/.test(text)) failures.push(`${file}: missing MVP traceability`);
  } catch {
    failures.push(`${file}: required handoff document missing`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Documentation links and MVP traceability passed (${count} local links).`);

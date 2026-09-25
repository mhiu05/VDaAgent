import { IdSchema } from '../packages/contracts/src/index.js';
import { postgresDriver } from '../packages/db/src/driver.js';
import { repairTerminalLegacyRun } from '../packages/db/src/workflow/repair-terminal-legacy-run.js';

const args = process.argv.slice(2);
const value = (name: string) =>
  args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);

async function main() {
  const orgId = IdSchema.parse(value('--org'));
  const runIds = args
    .filter((arg) => arg.startsWith('--run='))
    .map((arg) => IdSchema.parse(arg.slice('--run='.length)));
  if (!runIds.length || new Set(runIds).size !== runIds.length)
    throw new Error('Provide one or more distinct --run=<id> values.');
  const olderThan = new Date(value('--older-than') ?? '');
  if (Number.isNaN(olderThan.getTime()))
    throw new Error('Provide --older-than=<ISO timestamp> after all run owners have stopped.');
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl || !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol))
    throw new Error('SUPABASE_DB_URL must be a PostgreSQL connection string.');
  const db = postgresDriver(databaseUrl);
  try {
    const previews = [];
    for (const runId of runIds)
      previews.push(await repairTerminalLegacyRun(db, orgId, runId, { olderThan }));
    for (const preview of previews)
      process.stdout.write(
        `${JSON.stringify({ event: 'terminal_legacy_repair_preview', ...preview })}\n`,
      );
    if (!args.includes('--apply')) return;
    if (previews.some((preview) => preview.reason))
      throw new Error('At least one selected run is ineligible; no repair was started.');
    for (const runId of runIds) {
      await repairTerminalLegacyRun(db, orgId, runId, { olderThan, apply: true });
      process.stdout.write(
        `${JSON.stringify({ event: 'terminal_legacy_run_repaired', org_id: orgId, run_id: runId })}\n`,
      );
    }
  } finally {
    await db.close();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Repair failed.'}\n`);
  process.exitCode = 1;
});

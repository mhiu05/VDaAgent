import { IdSchema } from '../packages/contracts/src/index.js';
import { postgresDriver } from '../packages/db/src/driver.js';
import { retireLegacyRun } from '../packages/db/src/workflow/retire-legacy-run.js';

function value(name: string): string | undefined {
  return process.argv
    .slice(2)
    .find((arg) => arg.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function main() {
  const orgId = IdSchema.parse(value('--org'));
  const runIds = process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--run='))
    .map((arg) => IdSchema.parse(arg.slice('--run='.length)));
  if (!runIds.length || new Set(runIds).size !== runIds.length)
    throw new Error('Provide one or more distinct --run=<id> values.');
  const cutoverAt = new Date(value('--cutover-at') ?? '');
  if (Number.isNaN(cutoverAt.getTime()))
    throw new Error('Provide --cutover-at=<ISO timestamp> from the deployment record.');
  const apply = process.argv.includes('--apply');
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl || !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol))
    throw new Error('SUPABASE_DB_URL must be a PostgreSQL connection string.');
  const db = postgresDriver(databaseUrl);
  try {
    const previews = [];
    for (const runId of runIds)
      previews.push(await retireLegacyRun(db, orgId, runId, { cutoverAt }));
    for (const preview of previews)
      process.stdout.write(
        `${JSON.stringify({ event: 'legacy_retirement_preview', ...preview })}\n`,
      );
    if (!apply) return;
    if (previews.some((preview) => preview.reason))
      throw new Error('At least one selected run is ineligible; no retirement was started.');
    for (const runId of runIds) {
      await retireLegacyRun(db, orgId, runId, { apply: true, cutoverAt });
      process.stdout.write(
        `${JSON.stringify({ event: 'legacy_run_retired', org_id: orgId, run_id: runId })}\n`,
      );
    }
  } finally {
    await db.close();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Retirement failed.'}\n`);
  process.exitCode = 1;
});

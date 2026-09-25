import { IdSchema } from '../packages/contracts/src/index.js';
import { postgresDriver } from '../packages/db/src/driver.js';
import { reconcileStalledTurn } from '../packages/db/src/workflow/reconcile-stalled-turn.js';

function value(name: string): string | undefined {
  return process.argv
    .slice(2)
    .find((arg) => arg.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function main() {
  const orgId = IdSchema.parse(value('--org'));
  const conversationId = IdSchema.parse(value('--conversation'));
  const clientTurnId = IdSchema.parse(value('--client-turn'));
  const olderThan = new Date(value('--older-than') ?? '');
  if (Number.isNaN(olderThan.getTime()))
    throw new Error('Provide --older-than=<ISO timestamp> after the HTTP owner has stopped.');
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--owner-stopped'))
    throw new Error('Apply requires --owner-stopped after stopping all owners of this turn.');
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl || !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol))
    throw new Error('SUPABASE_DB_URL must be a PostgreSQL connection string.');
  const db = postgresDriver(databaseUrl);
  try {
    const preview = await reconcileStalledTurn(db, orgId, conversationId, clientTurnId, {
      olderThan,
    });
    process.stdout.write(`${JSON.stringify({ event: 'stalled_turn_preview', ...preview })}\n`);
    if (!apply) return;
    await reconcileStalledTurn(db, orgId, conversationId, clientTurnId, {
      olderThan,
      apply: true,
      ownerStopped: true,
    });
    process.stdout.write(
      `${JSON.stringify({
        event: 'stalled_turn_reconciled',
        org_id: orgId,
        conversation_id: conversationId,
        client_turn_id: clientTurnId,
      })}\n`,
    );
  } finally {
    await db.close();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Reconciliation failed.'}\n`);
  process.exitCode = 1;
});

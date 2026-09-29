import { ConversationSchema, type Conversation } from '@vda/contracts';
import { authorizeInTransaction } from '../authorization/authorization-repository';
import type { Driver } from '../driver';
import { fail } from '../errors';
import type { ExternalDeliveryInput, ExternalDeliveryLease } from '../types';

export class ExternalChannelRepository {
  constructor(private readonly db: Driver) {}

  async ensureConversation(user: string, org: string, id: string): Promise<Conversation> {
    return this.db.transaction(async (tx) => {
      await authorizeInTransaction(tx, user, org, true);
      const date = new Date().toISOString();
      await tx.query(
        `INSERT INTO conversations(org_id,id,created_by,kind,title,created_at,updated_at)
         VALUES($1,$2,$3,'interactive','Telegram', $4,$4)
         ON CONFLICT(org_id,id) DO NOTHING`,
        [org, id, user, date],
      );
      const rows = await tx.query(
        'SELECT org_id,id,created_by,kind,title,created_at,updated_at FROM conversations WHERE org_id=$1 AND id=$2',
        [org, id],
      );
      const row = rows[0];
      if (!row || row.created_by !== user || row.kind !== 'interactive')
        fail('EXTERNAL_CONVERSATION_CONFLICT', 403);
      return ConversationSchema.parse({
        conversation_id: row.id,
        org_id: row.org_id,
        created_by: row.created_by,
        kind: row.kind,
        title: row.title,
        created_at: new Date(String(row.created_at)).toISOString(),
        updated_at: new Date(String(row.updated_at)).toISOString(),
      });
    });
  }

  async enqueueDelivery(user: string, org: string, input: ExternalDeliveryInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      await authorizeInTransaction(tx, user, org, true);
      const message = await tx.query(
        `SELECT id FROM messages WHERE org_id=$1 AND id=$2 AND conversation_id=$3 AND role='assistant'`,
        [org, input.assistant_message_id, input.conversation_id],
      );
      if (!message[0]) fail('EXTERNAL_DELIVERY_MESSAGE_NOT_FOUND', 404);
      await tx.query(
        `INSERT INTO external_channel_deliveries
          (org_id,id,channel,event_key,chat_id,external_user_id,created_by,conversation_id,assistant_message_id)
         VALUES($1,$2,'telegram',$3,$4,$5,$6,$7,$8)
         ON CONFLICT(channel,event_key) DO NOTHING`,
        [
          org,
          input.delivery_id,
          input.event_key,
          input.chat_id,
          input.external_user_id,
          user,
          input.conversation_id,
          input.assistant_message_id,
        ],
      );
      const existing = await tx.query(
        `SELECT org_id,id,chat_id,external_user_id,created_by,conversation_id,assistant_message_id
         FROM external_channel_deliveries WHERE channel='telegram' AND event_key=$1`,
        [input.event_key],
      );
      const row = existing[0];
      if (
        !row ||
        row.org_id !== org ||
        row.id !== input.delivery_id ||
        row.chat_id !== input.chat_id ||
        row.external_user_id !== input.external_user_id ||
        row.created_by !== user ||
        row.conversation_id !== input.conversation_id ||
        row.assistant_message_id !== input.assistant_message_id
      )
        fail('EXTERNAL_EVENT_CONFLICT', 409);
    });
  }

  async claimDelivery(
    workerId: string,
    now = new Date(),
    leaseMs = 30_000,
  ): Promise<ExternalDeliveryLease | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT d.* FROM external_channel_deliveries d
         JOIN messages m ON m.org_id=d.org_id AND m.id=d.assistant_message_id
         WHERE d.next_attempt_at<=$1 AND d.attempts<5
           AND (d.status='pending' OR (d.status='sending' AND d.lease_until<$1))
           AND m.status IN ('completed','failed','cancelled')
         ORDER BY d.next_attempt_at,d.created_at,d.id LIMIT 1
         FOR UPDATE OF d SKIP LOCKED`,
        [now.toISOString()],
      );
      const row = rows[0];
      if (!row) return null;
      const attempts = Number(row.attempts) + 1;
      await tx.query(
        `UPDATE external_channel_deliveries
         SET status='sending',attempts=$1,worker_id=$2,lease_until=$3,updated_at=$4
         WHERE org_id=$5 AND id=$6`,
        [
          attempts,
          workerId,
          new Date(now.getTime() + leaseMs).toISOString(),
          now.toISOString(),
          row.org_id,
          row.id,
        ],
      );
      return {
        delivery_id: String(row.id),
        event_key: String(row.event_key),
        chat_id: String(row.chat_id),
        external_user_id: String(row.external_user_id),
        conversation_id: String(row.conversation_id),
        assistant_message_id: String(row.assistant_message_id),
        org_id: String(row.org_id),
        user_id: String(row.created_by),
        worker_id: workerId,
        attempts,
      };
    });
  }

  async finishDelivery(
    lease: ExternalDeliveryLease,
    outcome: { sent: boolean; error_code?: string },
  ): Promise<void> {
    const now = new Date();
    const failed = !outcome.sent && lease.attempts >= 5;
    const status = outcome.sent ? 'sent' : failed ? 'failed' : 'pending';
    const next = new Date(now.getTime() + Math.min(60_000, 2 ** lease.attempts * 1_000));
    const rows = await this.db.query(
      `UPDATE external_channel_deliveries
       SET status=$1,worker_id=NULL,lease_until=NULL,next_attempt_at=$2,
         sent_at=CASE WHEN $3::boolean THEN $4::timestamptz ELSE sent_at END,
         last_error=$5,updated_at=$4
       WHERE org_id=$6 AND id=$7 AND status='sending' AND worker_id=$8
         AND attempts=$9 AND lease_until>$4
       RETURNING id`,
      [
        status,
        next.toISOString(),
        outcome.sent,
        now.toISOString(),
        outcome.sent ? null : (outcome.error_code ?? 'EXTERNAL_SEND_FAILED').slice(0, 100),
        lease.org_id,
        lease.delivery_id,
        lease.worker_id,
        lease.attempts,
      ],
    );
    if (!rows[0]) fail('EXTERNAL_DELIVERY_LEASE_LOST', 409);
  }
}

import type { Repository, ExternalDeliveryLease } from '@vda/db';
import {
  TelegramAdapter,
  telegramResultText,
  type ExternalChannelAdapter,
} from '@vda/agents/external/telegram';

export async function dispatchExternalDelivery(
  repository: Repository,
  lease: ExternalDeliveryLease,
  adapter: ExternalChannelAdapter = new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN ?? ''),
): Promise<void> {
  try {
    const answer = await repository.getMessage(
      lease.user_id,
      lease.org_id,
      lease.conversation_id,
      lease.assistant_message_id,
    );
    if (!['completed', 'failed', 'cancelled'].includes(answer.status))
      throw new Error('EXTERNAL_ANSWER_NOT_TERMINAL');
    await adapter.send(
      lease.chat_id,
      telegramResultText({
        status: answer.status as 'completed' | 'failed' | 'cancelled',
        content: answer.content,
        org_id: lease.org_id,
        conversation_id: lease.conversation_id,
        public_url: process.env.VDA_PUBLIC_URL,
      }),
    );
    await repository.finishExternalDelivery(lease, { sent: true });
    console.log(
      JSON.stringify({
        event: 'external_delivery_sent',
        channel: 'telegram',
        delivery_id: lease.delivery_id,
        attempts: lease.attempts,
      }),
    );
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z0-9_]{1,100}$/.test(error.message)
        ? error.message
        : 'TELEGRAM_DELIVERY_FAILED';
    await repository.finishExternalDelivery(lease, { sent: false, error_code: code });
    console.error(
      JSON.stringify({
        event: 'external_delivery_retry',
        channel: 'telegram',
        delivery_id: lease.delivery_id,
        attempts: lease.attempts,
        error_code: code,
      }),
    );
  }
}

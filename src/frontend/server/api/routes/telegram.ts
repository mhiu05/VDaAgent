import { AgentTurnRequestSchema } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { RepositoryError } from '@vda/db';
import {
  TelegramAdapter,
  TelegramUpdateSchema,
  type ExternalChannelAdapter,
  telegramBinding,
  telegramResultText,
  telegramTurnIdentity,
  verifyTelegramSecret,
} from '@vda/agents/external/telegram';
import { agentTurnSubmitter } from '../streaming/agent-turn';

const ok = () => Response.json({ ok: true });

async function readUpdate(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new RepositoryError('TELEGRAM_UPDATE_INVALID', 400);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let raw = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) throw new RepositoryError('TELEGRAM_UPDATE_TOO_LARGE', 413);
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return TelegramUpdateSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    if (error instanceof SyntaxError || error instanceof TypeError)
      throw new RepositoryError('TELEGRAM_UPDATE_INVALID', 400);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Secret-verified external entrypoint; organization access is checked by repository operations. */
export async function telegramWebhook(
  request: Request,
  repo: Repository,
  options: {
    adapter?: ExternalChannelAdapter;
    submit?: ReturnType<typeof agentTurnSubmitter>['submit'];
  } = {},
): Promise<Response> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret || !process.env.TELEGRAM_BINDINGS_JSON)
    throw new RepositoryError('TELEGRAM_NOT_CONFIGURED', 503);
  if (!verifyTelegramSecret(request.headers.get('x-telegram-bot-api-secret-token'), secret))
    throw new RepositoryError('TELEGRAM_WEBHOOK_DENIED', 401);
  const update = await readUpdate(request);
  if (!update.message) return ok();
  const message = update.message;
  const chatId = String(message.chat.id);
  const binding = telegramBinding(
    process.env.TELEGRAM_BINDINGS_JSON,
    chatId,
    String(message.from.id),
  );
  if (!binding) return ok();
  const adapter = options.adapter ?? new TelegramAdapter(token);
  const command = message.text.split(/\s+/)[0]?.split('@')[0]?.toLowerCase();
  if (command === '/start' || command === '/help') {
    await adapter.send(
      chatId,
      'Gửi câu hỏi về tồn kho. Dùng /status để xem tiến độ, /latest để xem câu trả lời gần nhất, hoặc /report để tạo báo cáo mới.',
    );
    return ok();
  }
  const identity = telegramTurnIdentity(binding, update.update_id, message.date);
  await repo.ensureExternalConversation(binding.user_id, binding.org_id, identity.conversation_id);
  if (command === '/status' || command === '/latest') {
    const snapshot = await repo.getLatestAgentTurnJob(
      binding.user_id,
      binding.org_id,
      identity.conversation_id,
    );
    if (!snapshot) {
      await adapter.send(chatId, 'Chưa có yêu cầu phân tích trong cuộc trò chuyện này.');
      return ok();
    }
    const job = snapshot.job;
    if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
      await adapter.send(chatId, 'Yêu cầu gần nhất vẫn đang được xử lý.');
      return ok();
    }
    const answer = await repo.getMessage(
      binding.user_id,
      binding.org_id,
      identity.conversation_id,
      job.assistant_message_id,
    );
    if (
      answer.status !== 'completed' &&
      answer.status !== 'failed' &&
      answer.status !== 'cancelled'
    ) {
      await adapter.send(chatId, 'Yêu cầu gần nhất vẫn đang được xử lý.');
      return ok();
    }
    await adapter.send(
      chatId,
      telegramResultText({
        status: answer.status,
        content: answer.content,
        org_id: binding.org_id,
        conversation_id: identity.conversation_id,
        public_url: process.env.VDA_PUBLIC_URL,
      }),
    );
    return ok();
  }
  if (command?.startsWith('/') && command !== '/report') {
    await adapter.send(chatId, 'Lệnh chưa được hỗ trợ. Dùng /help để xem các lựa chọn.');
    return ok();
  }
  const input = AgentTurnRequestSchema.parse({
    org_id: binding.org_id,
    client_turn_id: identity.client_turn_id,
    text: command === '/report' ? 'Tạo báo cáo phân tích tồn kho luân chuyển chậm.' : message.text,
    scope: binding.scope,
    data_as_of: identity.data_as_of,
    use_case: 'slow_moving_inventory',
    agent_target: command === '/report' ? 'coordinator' : binding.agent_target,
    ...(command === '/report' ? { report_intent: 'new' } : {}),
  });
  const accepted = await (
    options.submit ? { submit: options.submit } : agentTurnSubmitter(repo)
  ).submit(binding.user_id, input, identity.idempotency_key, identity.conversation_id);
  await repo.enqueueExternalDelivery(binding.user_id, binding.org_id, {
    delivery_id: identity.delivery_id,
    event_key: String(update.update_id),
    chat_id: chatId,
    external_user_id: String(message.from.id),
    conversation_id: identity.conversation_id,
    assistant_message_id: accepted.assistant_message_id,
  });
  return ok();
}

import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AgentKeySchema, IdSchema, ScopeSchema } from '@vda/contracts';
import { localDate, stableId } from '@vda/domain';

const TelegramBindingSchema = z
  .object({
    chat_id: z.string().min(1).max(100),
    telegram_user_id: z.string().min(1).max(100),
    user_id: IdSchema,
    org_id: IdSchema,
    scope: ScopeSchema,
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA timezone'),
    agent_target: AgentKeySchema.default('coordinator'),
  })
  .strict();
export type TelegramBinding = z.infer<typeof TelegramBindingSchema>;

const TelegramBindingsSchema = z
  .array(TelegramBindingSchema)
  .max(100)
  .superRefine((bindings, ctx) => {
    const identities = new Set<string>();
    bindings.forEach((binding, index) => {
      const identity = `${binding.chat_id}:${binding.telegram_user_id}`;
      if (identities.has(identity))
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: 'Duplicate Telegram chat/user binding',
        });
      identities.add(identity);
    });
  });

export const TelegramUpdateSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    message: z
      .object({
        message_id: z.number().int().nonnegative(),
        date: z.number().int().nonnegative().max(253_402_300_799),
        from: z.object({ id: z.number().int().positive() }).passthrough(),
        chat: z.object({ id: z.number().int() }).passthrough(),
        text: z.string().trim().min(1).max(2_000),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;

export function telegramBinding(
  raw: string | undefined,
  chatId: string,
  telegramUserId: string,
): TelegramBinding | null {
  if (!raw) return null;
  const bindings = TelegramBindingsSchema.parse(JSON.parse(raw));
  return (
    bindings.find(
      (binding) => binding.chat_id === chatId && binding.telegram_user_id === telegramUserId,
    ) ?? null
  );
}

export function verifyTelegramSecret(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function telegramTurnIdentity(
  binding: TelegramBinding,
  updateId: number,
  messageDate: number,
) {
  return {
    conversation_id: stableId(
      `telegram:conversation:${binding.org_id}:${binding.chat_id}:${binding.telegram_user_id}`,
    ),
    client_turn_id: stableId(`telegram:turn:${binding.org_id}:${binding.chat_id}:${updateId}`),
    delivery_id: stableId(`telegram:delivery:${updateId}`),
    idempotency_key: `telegram:${updateId}`,
    // Use Telegram's immutable message time so a retry after midnight has the same request body.
    data_as_of: localDate(new Date(messageDate * 1_000), binding.timezone),
  };
}

export interface ExternalChannelAdapter {
  send(destination: string, text: string): Promise<void>;
}

export class TelegramAdapter implements ExternalChannelAdapter {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(destination: string, text: string): Promise<void> {
    const response = await this.fetcher(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: destination, text: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`TELEGRAM_SEND_${response.status}`);
    const result = z.object({ ok: z.boolean() }).parse(await response.json());
    if (!result.ok) throw new Error('TELEGRAM_SEND_REJECTED');
  }
}

export function telegramResultText(input: {
  status: 'completed' | 'failed' | 'cancelled';
  content: string;
  org_id: string;
  conversation_id: string;
  public_url?: string;
}): string {
  const summary = input.content.replace(/\s+/g, ' ').trim().slice(0, 1200);
  const text =
    summary ||
    (input.status === 'completed'
      ? 'Phân tích đã hoàn tất. Mở workspace để xem kết quả.'
      : 'Phân tích chưa hoàn tất. Mở workspace để xem trạng thái.');
  if (!input.public_url) return text;
  const link = new URL(`/chat/${encodeURIComponent(input.conversation_id)}`, input.public_url);
  link.searchParams.set('org_id', input.org_id);
  return `${text}\n\nXem đầy đủ: ${link.toString()}`;
}

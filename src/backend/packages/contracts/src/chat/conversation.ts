import { z } from 'zod';
import { CursorSchema, IdSchema, TimestampSchema } from '../common/primitives';
import { MessageStatusSchema } from './message';

export const ConversationKindSchema = z.enum(['interactive', 'scheduled']);
export type ConversationKind = z.infer<typeof ConversationKindSchema>;
export const ConversationSchema = z
  .object({
    conversation_id: IdSchema,
    org_id: IdSchema,
    created_by: IdSchema,
    kind: ConversationKindSchema,
    title: z.string().trim().min(1).max(80),
    created_at: TimestampSchema,
    updated_at: TimestampSchema,
  })
  .strict();
export type Conversation = z.infer<typeof ConversationSchema>;
export const ConversationListItemSchema = ConversationSchema.extend({
  latest_status: MessageStatusSchema.nullable(),
});
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;
export const PageRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: CursorSchema.nullable().default(null),
  })
  .strict();
export type PageRequest = z.infer<typeof PageRequestSchema>;
export const ConversationPageSchema = z
  .object({
    conversations: z.array(ConversationListItemSchema),
    next_cursor: CursorSchema.nullable(),
  })
  .strict();
export type ConversationPage = z.infer<typeof ConversationPageSchema>;

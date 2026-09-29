import { z } from 'zod';
import { IdSchema, RoleSchema, TimestampSchema } from '@vda/contracts';

export const OrgBody = z.object({ org_id: IdSchema }).strict();
export const TriggerBody = z
  .object({ org_id: IdSchema, scheduled_for: TimestampSchema.optional() })
  .strict();
export const TickBody = z.object({ org_id: IdSchema, now: TimestampSchema.optional() }).strict();
export const DevelopmentRoleBody = z.object({ role: RoleSchema }).strict();
export const OkSchema = z.object({ ok: z.literal(true) });

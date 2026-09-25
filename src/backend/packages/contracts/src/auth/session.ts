import { z } from 'zod';
import { IdSchema, RoleSchema } from '../common/primitives';

export const SessionSchema = z.object({
  user_id: IdSchema,
  email: z.string(),
  mode: z.literal('supabase'),
  organizations: z.array(z.object({ org_id: IdSchema, name: z.string(), role: RoleSchema })),
});
export type Session = z.infer<typeof SessionSchema>;

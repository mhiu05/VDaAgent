import { z } from 'zod';

export const noStore = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json<T>(schema: z.ZodType<T>, value: unknown, status = 200) {
  return Response.json(schema.parse(value), { status, headers: noStore });
}

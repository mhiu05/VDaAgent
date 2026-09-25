import { z } from 'zod';

export const GeminiResponseSchema = z
  .object({
    candidates: z
      .array(
        z.object({
          content: z
            .object({ parts: z.array(z.object({ text: z.string().optional() }).passthrough()) })
            .optional(),
        }),
      )
      .default([]),
  })
  .passthrough();

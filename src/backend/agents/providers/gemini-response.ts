import { z } from 'zod';

export const GeminiResponseSchema = z
  .object({
    candidates: z
      .array(
        z.object({
          finishReason: z.string().optional(),
          content: z
            .object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() }).passthrough()) })
            .optional(),
        }),
      )
      .default([]),
  })
  .passthrough();

export class GeminiOutputError extends Error {
  readonly failure_reason = 'incomplete_output';
  constructor() { super('GEMINI_RESPONSE_INVALID'); }
}

/** Parts belong to one candidate; other candidates are alternative answers. */
export function geminiOutputText(body: unknown): string | undefined {
  const candidate = GeminiResponseSchema.parse(body).candidates[0];
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new GeminiOutputError();
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => part.thought !== true)
    .map((part) => part.text ?? '')
    .join('');
  return text.trim() ? text : undefined;
}

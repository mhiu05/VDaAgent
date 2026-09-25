import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { Claim } from '@vda/contracts';
import { getConfig, type AppConfig, type LlmProvider } from '@vda/config';
import { SAFE_SUMMARY } from '@vda/domain';
import { GeminiResponseSchema } from '../../providers/gemini-response';

const NarrativeSchema = z
  .object({ summary_key: z.literal('inventory_descriptive'), claim_ids: z.array(z.string()) })
  .strict();

const instructions =
  'Select every supplied claim ID exactly once and use inventory_descriptive. Do not calculate, infer causation, create SQL, add claims or change IDs. The data is provisional inventory evidence.';

export type Narrative = { summary: string; claims: Claim[]; provider: LlmProvider };

export interface NarrativeProvider {
  narrate(claims: Claim[]): Promise<Narrative>;
}

function narrativeFromClaimIds(
  parsed: z.infer<typeof NarrativeSchema>,
  claims: Claim[],
  provider: LlmProvider,
): Narrative {
  if (
    parsed.claim_ids.length !== claims.length ||
    new Set(parsed.claim_ids).size !== claims.length ||
    parsed.claim_ids.some((id) => !claims.some((claim) => claim.claim_id === id))
  )
    throw new Error('PROVIDER_UNGROUNDED_OUTPUT');
  return {
    summary: SAFE_SUMMARY,
    claims: parsed.claim_ids.map((id) => claims.find((claim) => claim.claim_id === id)!),
    provider,
  };
}

export class GeminiProvider implements NarrativeProvider {
  readonly provider = 'gemini' as const;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async narrate(claims: Claim[]): Promise<Narrative> {
    let response: Response;
    try {
      response = await this.fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: instructions }] },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: JSON.stringify(
                      claims.map(({ claim_id, metric_key }) => ({ claim_id, metric_key })),
                    ),
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              responseJsonSchema: {
                type: 'object',
                properties: {
                  summary_key: { type: 'string', enum: ['inventory_descriptive'] },
                  claim_ids: { type: 'array', items: { type: 'string' } },
                },
                required: ['summary_key', 'claim_ids'],
                additionalProperties: false,
              },
              temperature: 0,
            },
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      throw new Error('GEMINI_REQUEST_FAILED');
    }
    if (!response.ok) throw new Error('GEMINI_REQUEST_FAILED');
    try {
      const body: unknown = await response.json();
      const text = GeminiResponseSchema.parse(body)
        .candidates.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text)
        .find((part): part is string => Boolean(part));
      if (!text) throw new Error('missing Gemini response text');
      return narrativeFromClaimIds(NarrativeSchema.parse(JSON.parse(text)), claims, this.provider);
    } catch (error) {
      if (error instanceof Error && error.message === 'PROVIDER_UNGROUNDED_OUTPUT') throw error;
      throw new Error('GEMINI_RESPONSE_INVALID');
    }
  }
}

export class OpenAIProvider implements NarrativeProvider {
  readonly provider = 'openai' as const;
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}
  async narrate(claims: Claim[]): Promise<Narrative> {
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      instructions,
      input: JSON.stringify(claims.map(({ claim_id, metric_key }) => ({ claim_id, metric_key }))),
      text: { format: zodTextFormat(NarrativeSchema, 'inventory_narrative') },
    });
    return narrativeFromClaimIds(
      NarrativeSchema.parse(response.output_parsed),
      claims,
      this.provider,
    );
  }
}

export class FallbackNarrativeProvider implements NarrativeProvider {
  constructor(private readonly providers: readonly NarrativeProvider[]) {
    if (providers.length === 0) throw new Error('LLM_PROVIDER_REQUIRED');
  }

  async narrate(claims: Claim[]): Promise<Narrative> {
    for (const provider of this.providers) {
      try {
        return await provider.narrate(claims);
      } catch {
        // The next provider receives the same constrained, evidence-only prompt.
      }
    }
    throw new Error('ALL_LLM_PROVIDERS_FAILED');
  }
}

export function createProvider(config: AppConfig = getConfig()): NarrativeProvider {
  const providers: Record<LlmProvider, NarrativeProvider> = {
    gemini: new GeminiProvider(config.GEMINI_API_KEY!, config.GEMINI_MODEL!),
    openai: new OpenAIProvider(
      new OpenAI({ apiKey: config.OPENAI_API_KEY!, timeout: 30_000, maxRetries: 1 }),
      config.OPENAI_MODEL!,
    ),
  };
  return new FallbackNarrativeProvider([
    providers[config.LLM_PRIMARY_PROVIDER],
    providers[config.LLM_FALLBACK_PROVIDER],
  ]);
}

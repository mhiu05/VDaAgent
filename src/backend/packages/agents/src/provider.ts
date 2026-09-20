import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import {
  AgentDecisionSchema,
  type AgentDecision,
  type Claim,
  type Role,
  type Scope,
} from '@vda/contracts';
import { getConfig, type AppConfig, type LlmProvider } from '@vda/config';
import { SAFE_SUMMARY } from './integrity';

const NarrativeSchema = z
  .object({ summary_key: z.literal('inventory_descriptive'), claim_ids: z.array(z.string()) })
  .strict();

const instructions =
  'Select every supplied claim ID exactly once and use inventory_descriptive. Do not calculate, infer causation, create SQL, add claims or change IDs. The data is provisional inventory evidence.';

const GeminiResponseSchema = z
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

export type Narrative = { summary: string; claims: Claim[]; provider: LlmProvider };

export interface NarrativeProvider {
  narrate(claims: Claim[]): Promise<Narrative>;
}

export type AgentDecisionContext = {
  question: string;
  scope: Scope;
  data_as_of: string;
  role: Role;
  catalog: {
    project_external_ids: string[];
    latest_snapshot_date: string | null;
  };
  recent_messages: { role: 'user' | 'assistant'; content: string }[];
  allowed_run_ids: string[];
};
export interface AgentDecisionProvider {
  decide(context: AgentDecisionContext): Promise<AgentDecision>;
}
const decisionInstructions =
  'Choose exactly one action for a VDa inventory request. Supported actions are create_analysis, get_analysis_result, or unsupported. Never calculate a metric, create a factual answer, SQL, an ID, a scope, a permission, or an action outside the supplied schema. create_analysis must use only a supplied focus enum. get_analysis_result may use only a run_id from allowed_run_ids. Return JSON only.';

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

export class GeminiAgentDecisionProvider implements AgentDecisionProvider {
  readonly provider = 'gemini' as const;
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}
  async decide(context: AgentDecisionContext): Promise<AgentDecision> {
    let response: Response;
    try {
      response = await this.fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: decisionInstructions }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify(context) }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseJsonSchema: {
                type: 'object',
                properties: {
                  action: {
                    type: 'string',
                    enum: ['create_analysis', 'get_analysis_result', 'unsupported'],
                  },
                  focus: { type: 'string' },
                  run_id: { type: 'string' },
                  reason_code: { type: 'string' },
                },
                required: ['action'],
                additionalProperties: false,
              },
              temperature: 0,
            },
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      throw new Error('GEMINI_AGENT_REQUEST_FAILED');
    }
    if (!response.ok) throw new Error('GEMINI_AGENT_REQUEST_FAILED');
    try {
      const body: unknown = await response.json();
      const text = GeminiResponseSchema.parse(body)
        .candidates.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text)
        .find((part): part is string => Boolean(part));
      if (!text) throw new Error('missing Gemini response text');
      return AgentDecisionSchema.parse(JSON.parse(text));
    } catch {
      throw new Error('GEMINI_AGENT_RESPONSE_INVALID');
    }
  }
}

export class OpenAIAgentDecisionProvider implements AgentDecisionProvider {
  readonly provider = 'openai' as const;
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}
  async decide(context: AgentDecisionContext): Promise<AgentDecision> {
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        store: false,
        instructions: decisionInstructions,
        input: JSON.stringify(context),
        text: { format: zodTextFormat(AgentDecisionSchema, 'agent_decision') },
      });
      return AgentDecisionSchema.parse(response.output_parsed);
    } catch {
      throw new Error('OPENAI_AGENT_REQUEST_FAILED');
    }
  }
}

export class FallbackAgentDecisionProvider implements AgentDecisionProvider {
  constructor(private readonly providers: readonly AgentDecisionProvider[]) {
    if (providers.length === 0) throw new Error('LLM_PROVIDER_REQUIRED');
  }
  async decide(context: AgentDecisionContext): Promise<AgentDecision> {
    for (const provider of this.providers) {
      try {
        return await provider.decide(context);
      } catch {
        // Each configured provider receives the same bounded context.
      }
    }
    throw new Error('ALL_AGENT_PROVIDERS_FAILED');
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

export function createDecisionProvider(config: AppConfig = getConfig()): AgentDecisionProvider {
  const providers: Record<LlmProvider, AgentDecisionProvider> = {
    gemini: new GeminiAgentDecisionProvider(config.GEMINI_API_KEY!, config.GEMINI_MODEL!),
    openai: new OpenAIAgentDecisionProvider(
      new OpenAI({ apiKey: config.OPENAI_API_KEY!, timeout: 30_000, maxRetries: 1 }),
      config.OPENAI_MODEL!,
    ),
  };
  return new FallbackAgentDecisionProvider([
    providers[config.LLM_PRIMARY_PROVIDER],
    providers[config.LLM_FALLBACK_PROVIDER],
  ]);
}

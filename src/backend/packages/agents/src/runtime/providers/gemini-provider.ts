import { z } from 'zod';
import { AgentPlanV1Schema, GroundedResponseSelectionV1Schema } from '@vda/contracts';
import type {
  AgentRuntimeComposerInput,
  AgentRuntimeComposerValidator,
  AgentRuntimePlannerInput,
  AgentRuntimePlannerValidator,
  AgentRuntimeProvider,
  AgentRuntimeProviderResult,
} from './contracts';
import {
  AgentRuntimeProviderError,
  attemptSignal,
  classifyProviderError,
  providerHttpError,
  validateComposerResponse,
  validatePlannerResponse,
} from './errors';
import { composerInstructions, plannerInstructions } from './instructions';
import { responseUsage } from './telemetry';

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

function runtimeJsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { unrepresentable: 'any' });
}

export class GeminiAgentRuntimeProvider implements AgentRuntimeProvider {
  readonly provider = 'gemini' as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async plan(
    input: AgentRuntimePlannerInput,
    signal?: AbortSignal,
    validate?: AgentRuntimePlannerValidator,
  ) {
    const result = await this.request(
      AgentPlanV1Schema,
      'agent_runtime_plan',
      plannerInstructions,
      { question: input.question, context: input.context, capabilities: input.capabilities },
      signal,
    );
    await validatePlannerResponse(result.value, validate);
    return result;
  }

  async compose(
    input: AgentRuntimeComposerInput,
    signal?: AbortSignal,
    validate?: AgentRuntimeComposerValidator,
  ) {
    const result = await this.request(
      GroundedResponseSelectionV1Schema,
      'grounded_response_selection',
      composerInstructions,
      {
        observations: input.observations,
        available_workspace_actions: input.available_workspace_actions,
      },
      signal,
    );
    await validateComposerResponse(result.value, validate);
    return result;
  }

  private async request<T>(
    schema: z.ZodType<T>,
    schemaName: string,
    instructions: string,
    input: Record<string, unknown>,
    parentSignal?: AbortSignal,
  ): Promise<AgentRuntimeProviderResult<T>> {
    const startedAt = Date.now();
    const attempt = attemptSignal(parentSignal, this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: instructions }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseJsonSchema: runtimeJsonSchema(schema),
              temperature: 0,
            },
          }),
          signal: attempt.signal,
        },
      );
    } catch (error) {
      throw classifyProviderError(error, parentSignal, attempt.timeout);
    }
    if (!response.ok) throw providerHttpError(response.status);
    try {
      const body: unknown = await response.json();
      const text = GeminiResponseSchema.parse(body)
        .candidates.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text)
        .find((part): part is string => Boolean(part));
      if (!text) throw new Error('missing Gemini response text');
      return {
        value: schema.parse(JSON.parse(text)),
        metadata: {
          provider: this.provider,
          model: this.model,
          request_id: response.headers.get('x-request-id'),
          latency_ms: Date.now() - startedAt,
          http_status: response.status,
          zero_data_retention: null,
          ...responseUsage(body),
          fallback_from: null,
        },
      };
    } catch {
      throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', true);
    }
  }
}

import { z } from 'zod';
import { AgentPlanV1Schema, GroundedResponseSelectionV1Schema } from '@vda/contracts';
import type {
  AgentRuntimeComposerInput,
  AgentRuntimeComposerValidator,
  AgentRuntimePlannerValidator,
  AgentRuntimePlannerInput,
  AgentRuntimeProvider,
  AgentRuntimeProviderResult,
} from './contracts';
import { AgentRuntimeProviderError, isTimeoutAbort } from './errors';
import { composerInstructions, plannerInstructions } from './instructions';

type XaiProviderOptions = {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  requireZdr: boolean;
  fetchFn?: typeof fetch;
};

const XaiResponseSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    output: z
      .array(
        z
          .object({
            type: z.string(),
            content: z
              .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
              .optional(),
          })
          .passthrough(),
      )
      .default([]),
    usage: z
      .object({
        input_tokens: z.number().finite().optional(),
        output_tokens: z.number().finite().optional(),
        total_tokens: z.number().finite().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function attemptSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return { timeout, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
}

function transportError(
  error: unknown,
  parentSignal: AbortSignal | undefined,
  timeout: AbortSignal,
): AgentRuntimeProviderError {
  if (error instanceof AgentRuntimeProviderError) return error;
  if (timeout.aborted) return new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true);
  if (isTimeoutAbort(parentSignal)) return new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true);
  if (parentSignal?.aborted) return new AgentRuntimeProviderError('TURN_CANCELLED', false);
  return new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', true);
}

function httpError(status: number): AgentRuntimeProviderError {
  if (status === 408 || status === 429 || status >= 500)
    return new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', true);
  return new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', false);
}

function textFromResponse(body: z.infer<typeof XaiResponseSchema>): string | null {
  for (const item of body.output) {
    if (item.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  return null;
}

/**
 * Stateless xAI Responses adapter. It deliberately does not expose xAI tools,
 * previous-response IDs, Files, Collections, or response bodies to the runtime.
 */
export class XaiAgentRuntimeProvider implements AgentRuntimeProvider {
  readonly provider = 'xai' as const;
  private readonly fetchFn: typeof fetch;

  get model() {
    return this.options.model;
  }

  constructor(private readonly options: XaiProviderOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

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
    try {
      await validate?.(result.value);
    } catch {
      throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', true);
    }
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
    try {
      await validate?.(result.value);
    } catch {
      throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', true);
    }
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
    const attempt = attemptSignal(parentSignal, this.options.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchFn(`${this.options.baseUrl.replace(/\/$/, '')}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          store: false,
          instructions,
          input: JSON.stringify(input),
          text: {
            format: {
              type: 'json_schema',
              name: schemaName,
              schema: z.toJSONSchema(schema, { unrepresentable: 'any' }),
              strict: true,
            },
          },
        }),
        signal: attempt.signal,
      });
    } catch (error) {
      throw transportError(error, parentSignal, attempt.timeout);
    }
    if (!response.ok) throw httpError(response.status);

    const zeroDataRetention =
      response.headers.get('x-zero-data-retention')?.toLowerCase() === 'true';
    if (this.options.requireZdr && !zeroDataRetention)
      throw new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', false);

    try {
      const body = XaiResponseSchema.parse(await response.json());
      const text = textFromResponse(body);
      if (!text) throw new Error('missing xAI response text');
      return {
        value: schema.parse(JSON.parse(text)),
        metadata: {
          provider: this.provider,
          model: body.model ?? this.options.model,
          request_id: response.headers.get('x-request-id') ?? body.id ?? null,
          latency_ms: Date.now() - startedAt,
          http_status: response.status,
          zero_data_retention: zeroDataRetention,
          input_tokens: body.usage?.input_tokens ?? null,
          output_tokens: body.usage?.output_tokens ?? null,
          total_tokens: body.usage?.total_tokens ?? null,
          fallback_from: null,
        },
      };
    } catch {
      throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', true);
    }
  }
}

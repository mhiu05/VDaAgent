import OpenAI, { APIError } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
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
  isTimeoutAbort,
  providerHttpError,
  validateComposerResponse,
  validatePlannerResponse,
} from './errors';
import { composerInstructions, plannerInstructions } from './instructions';
import { responseRequestId, responseUsage } from './telemetry';

export class OpenAIAgentRuntimeProvider implements AgentRuntimeProvider {
  readonly provider = 'openai' as const;

  constructor(
    private readonly client: OpenAI,
    readonly model: string,
    private readonly timeoutMs: number,
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
    signal?: AbortSignal,
  ): Promise<AgentRuntimeProviderResult<T>> {
    const startedAt = Date.now();
    const attempt = attemptSignal(signal, this.timeoutMs);
    try {
      const response = await this.client.responses.parse(
        {
          model: this.model,
          store: false,
          instructions,
          input: JSON.stringify(input),
          text: { format: zodTextFormat(schema, schemaName) },
        },
        { signal: attempt.signal },
      );
      return {
        value: schema.parse(response.output_parsed),
        metadata: {
          provider: this.provider,
          model: this.model,
          request_id: responseRequestId(response),
          latency_ms: Date.now() - startedAt,
          http_status: null,
          zero_data_retention: null,
          ...responseUsage(response),
          fallback_from: null,
        },
      };
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', true);
      if (error instanceof APIError) throw providerHttpError(error.status ?? 0);
      if (attempt.timeout.aborted) throw new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true);
      if (isTimeoutAbort(signal)) throw new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true);
      if (signal?.aborted) throw new AgentRuntimeProviderError('TURN_CANCELLED', false);
      throw new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', true);
    }
  }
}

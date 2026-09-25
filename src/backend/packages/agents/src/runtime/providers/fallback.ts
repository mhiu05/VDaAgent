import type { AgentRuntimeProvider as ConfiguredAgentRuntimeProvider } from '@vda/config';
import { MAX_AGENT_PROVIDER_ATTEMPTS } from '../limits';
import type {
  AgentRuntimeComposerInput,
  AgentRuntimeComposerValidator,
  AgentRuntimePlannerInput,
  AgentRuntimePlannerValidator,
  AgentRuntimeProvider,
  AgentRuntimeProviderResult,
} from './contracts';
import { AgentRuntimeProviderError, isTimeoutAbort } from './errors';
import type { RuntimeProviderTelemetry } from './telemetry';

export class OrderedFallbackAgentRuntimeProvider implements AgentRuntimeProvider {
  readonly provider = 'fallback' as const;
  readonly model = 'fallback';

  constructor(
    private readonly providers: readonly AgentRuntimeProvider[],
    private readonly telemetry: RuntimeProviderTelemetry = () => undefined,
  ) {
    if (providers.length === 0 || providers.length > MAX_AGENT_PROVIDER_ATTEMPTS)
      throw new Error('AGENT_RUNTIME_PROVIDER_COUNT_INVALID');
  }

  plan(
    input: AgentRuntimePlannerInput,
    signal?: AbortSignal,
    validate?: AgentRuntimePlannerValidator,
  ) {
    return this.withFallback('plan', signal, (provider) => provider.plan(input, signal, validate));
  }

  compose(
    input: AgentRuntimeComposerInput,
    signal?: AbortSignal,
    validate?: AgentRuntimeComposerValidator,
  ) {
    return this.withFallback('compose', signal, (provider) =>
      provider.compose(input, signal, validate),
    );
  }

  private async withFallback<T>(
    stage: 'plan' | 'compose',
    signal: AbortSignal | undefined,
    run: (provider: AgentRuntimeProvider) => Promise<AgentRuntimeProviderResult<T>>,
  ): Promise<AgentRuntimeProviderResult<T>> {
    let priorProvider: ConfiguredAgentRuntimeProvider | null = null;
    let lastError: AgentRuntimeProviderError | null = null;
    for (const [index, provider] of this.providers.entries()) {
      if (isTimeoutAbort(signal)) throw new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true);
      if (signal?.aborted) throw new AgentRuntimeProviderError('TURN_CANCELLED', false);
      const startedAt = Date.now();
      try {
        const result = await run(provider);
        this.telemetry({
          event: 'agent_runtime_provider_attempt',
          stage,
          attempt: index + 1,
          provider: provider.provider,
          model: provider.model,
          fallback_from: priorProvider,
          outcome: 'succeeded',
          error_code: null,
          latency_ms: Date.now() - startedAt,
          http_status: result.metadata.http_status,
          zero_data_retention: result.metadata.zero_data_retention,
          input_tokens: result.metadata.input_tokens,
          output_tokens: result.metadata.output_tokens,
          total_tokens: result.metadata.total_tokens,
        });
        return {
          ...result,
          metadata: { ...result.metadata, fallback_from: priorProvider },
        };
      } catch (error) {
        const normalized =
          error instanceof AgentRuntimeProviderError
            ? error
            : new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', true);
        this.telemetry({
          event: 'agent_runtime_provider_attempt',
          stage,
          attempt: index + 1,
          provider: provider.provider,
          model: provider.model,
          fallback_from: priorProvider,
          outcome: 'failed',
          error_code: normalized.code,
          latency_ms: Date.now() - startedAt,
          http_status: null,
          zero_data_retention: null,
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
        });
        if (!normalized.retryable) throw normalized;
        if (isTimeoutAbort(signal)) throw new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true);
        if (signal?.aborted) throw new AgentRuntimeProviderError('TURN_CANCELLED', false);
        lastError = normalized;
        priorProvider = provider.provider === 'fallback' ? priorProvider : provider.provider;
      }
    }
    throw lastError ?? new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', true);
  }
}

import OpenAI from 'openai';
import {
  getConfig,
  type AgentRuntimeProvider as ConfiguredAgentRuntimeProvider,
  type AppConfig,
} from '@vda/config';
import type { AgentRuntimeProvider } from './contracts';
import { AgentRuntimeProviderError } from './errors';
import { OrderedFallbackAgentRuntimeProvider } from './fallback';
import { GeminiAgentRuntimeProvider } from './gemini-provider';
import { OpenAIAgentRuntimeProvider } from './openai-provider';
import { emitRuntimeProviderTelemetry } from './telemetry';
import { XaiAgentRuntimeProvider } from './xai-provider';

export function createAgentRuntimeProvider(config: AppConfig = getConfig()): AgentRuntimeProvider {
  if (!config.GROK_RUNTIME_ENABLED)
    throw new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', false);
  const provider = (name: ConfiguredAgentRuntimeProvider): AgentRuntimeProvider => {
    if (name === 'gemini')
      return new GeminiAgentRuntimeProvider(
        config.GEMINI_API_KEY!,
        config.GEMINI_MODEL!,
        config.AGENT_PROVIDER_TIMEOUT_MS,
      );
    if (name === 'openai')
      return new OpenAIAgentRuntimeProvider(
        new OpenAI({
          apiKey: config.OPENAI_API_KEY!,
          timeout: config.AGENT_PROVIDER_TIMEOUT_MS,
          maxRetries: 0,
        }),
        config.OPENAI_MODEL!,
        config.AGENT_PROVIDER_TIMEOUT_MS,
      );
    return new XaiAgentRuntimeProvider({
      apiKey: config.XAI_API_KEY!,
      model: config.XAI_MODEL!,
      baseUrl: config.XAI_BASE_URL,
      timeoutMs: config.AGENT_PROVIDER_TIMEOUT_MS,
      requireZdr: config.XAI_REQUIRE_ZDR,
    });
  };
  return new OrderedFallbackAgentRuntimeProvider(
    [provider(config.AGENT_LLM_PRIMARY_PROVIDER), provider(config.AGENT_LLM_FALLBACK_PROVIDER)],
    emitRuntimeProviderTelemetry,
  );
}

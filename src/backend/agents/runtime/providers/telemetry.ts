import type { AgentRuntimeProvider as ConfiguredAgentRuntimeProvider } from '@vda/config';
import type { AgentRuntimeProviderName } from './contracts';
import type { AgentRuntimeProviderError } from './errors';

export type RuntimeProviderTelemetryEvent = {
  event: 'agent_runtime_provider_attempt';
  stage: 'plan' | 'compose';
  attempt: number;
  provider: AgentRuntimeProviderName;
  model: string;
  fallback_from: ConfiguredAgentRuntimeProvider | null;
  outcome: 'succeeded' | 'failed';
  error_code: AgentRuntimeProviderError['code'] | null;
  latency_ms: number;
  http_status: number | null;
  zero_data_retention: boolean | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
};

export type RuntimeProviderTelemetry = (event: RuntimeProviderTelemetryEvent) => void;

/** Deliberately metadata-only: never log prompts, outputs, keys, or evidence payloads. */
export function emitRuntimeProviderTelemetry(event: RuntimeProviderTelemetryEvent) {
  console.info(JSON.stringify(event));
}

export function responseRequestId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const requestId = (value as { _request_id?: unknown })._request_id;
  return typeof requestId === 'string' && requestId.length <= 200 ? requestId : null;
}

export function responseUsage(value: unknown) {
  if (!value || typeof value !== 'object')
    return { input_tokens: null, output_tokens: null, total_tokens: null };
  const usage = (value as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object')
    return { input_tokens: null, output_tokens: null, total_tokens: null };
  const read = (key: 'input_tokens' | 'output_tokens' | 'total_tokens') => {
    const valueAtKey = (usage as Record<string, unknown>)[key];
    return typeof valueAtKey === 'number' && Number.isFinite(valueAtKey) ? valueAtKey : null;
  };
  return {
    input_tokens: read('input_tokens'),
    output_tokens: read('output_tokens'),
    total_tokens: read('total_tokens'),
  };
}

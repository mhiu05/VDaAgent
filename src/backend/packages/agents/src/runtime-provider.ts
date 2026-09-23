import OpenAI, { APIError } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import {
  AgentPlanV1Schema,
  GroundedResponseSelectionV1Schema,
  type AgentPlanV1,
  type CapabilityName,
  type AvailableWorkspaceActionV1,
  type CanonicalAgentObservationV1,
  type GroundedResponseSelectionV1,
} from '@vda/contracts';
import {
  getConfig,
  type AgentRuntimeProvider as ConfiguredAgentRuntimeProvider,
  type AppConfig,
} from '@vda/config';
import { XaiAgentRuntimeProvider } from './xai-provider';
import { MAX_AGENT_PROVIDER_ATTEMPTS } from './runtime-limits';

export type AgentRuntimeProviderName = ConfiguredAgentRuntimeProvider | 'fallback';

export type RuntimeProviderMetadata = {
  provider: AgentRuntimeProviderName;
  model: string;
  request_id: string | null;
  latency_ms: number;
  http_status: number | null;
  zero_data_retention: boolean | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  fallback_from: ConfiguredAgentRuntimeProvider | null;
};

export type AgentRuntimeProviderResult<T> = {
  value: T;
  metadata: RuntimeProviderMetadata;
};

/** Server-owned, bounded projections only. Never include raw rows or secrets. */
export type AgentRuntimePlannerInput = {
  question: string;
  context: Record<string, unknown>;
  capabilities: CapabilityName[];
};

/**
 * The composer receives only non-factual observation metadata needed to rank
 * IDs. Canonical text, values, grounding references, and action payloads
 * never enter this provider contract: the renderer rehydrates those
 * server-side after an ID selection has been validated.
 */
export type AgentRuntimeComposerObservation = Pick<
  CanonicalAgentObservationV1,
  'observation_id' | 'kind' | 'availability' | 'support_level'
>;
export type AgentRuntimeComposerWorkspaceAction = Pick<AvailableWorkspaceActionV1, 'action_id'>;
export type AgentRuntimeComposerInput = {
  observations: AgentRuntimeComposerObservation[];
  available_workspace_actions: AgentRuntimeComposerWorkspaceAction[];
};

export type AgentRuntimeComposerValidator = (
  response: GroundedResponseSelectionV1,
) => void | Promise<void>;
export type AgentRuntimePlannerValidator = (plan: AgentPlanV1) => void | Promise<void>;

export interface AgentRuntimeProvider {
  readonly provider: AgentRuntimeProviderName;
  readonly model: string;
  plan(
    input: AgentRuntimePlannerInput,
    signal?: AbortSignal,
    validate?: AgentRuntimePlannerValidator,
  ): Promise<AgentRuntimeProviderResult<AgentPlanV1>>;
  compose(
    input: AgentRuntimeComposerInput,
    signal?: AbortSignal,
    validate?: AgentRuntimeComposerValidator,
  ): Promise<AgentRuntimeProviderResult<GroundedResponseSelectionV1>>;
}

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

export class AgentRuntimeProviderError extends Error {
  constructor(
    readonly code:
      'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'PROVIDER_OUTPUT_INVALID' | 'TURN_CANCELLED',
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

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

export const plannerInstructions =
  'Return one strict AgentPlanV1. Choose only listed capability IDs and only identifiers already present in the server-owned context. Never calculate metrics, write prose answers, invent IDs, infer permissions, SQL, URLs, scopes, artifacts, or evidence. The maximum is three sequential steps; do not create loops, dependencies, or tool calls.';
export const composerInstructions =
  'Return one strict GroundedResponseSelectionV1. Select and order only supplied observation_ids and workspace action_ids. Do not emit prose, findings, numbers, percentages, values, URLs, references, actions, prompts, or identifiers other than supplied IDs.';

function attemptSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return { timeout, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
}

/**
 * The runtime passes a combined client-cancel/turn-deadline signal to each
 * provider. AbortSignal.timeout carries a DOM TimeoutError reason, which lets
 * adapters preserve the public timeout result instead of misclassifying a
 * deadline as a user cancellation.
 */
export function isTimeoutAbort(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return false;
  const reason = signal.reason as { name?: unknown } | undefined;
  return reason?.name === 'TimeoutError';
}

function classifyProviderError(
  error: unknown,
  signal: AbortSignal | undefined,
  timeout: AbortSignal,
): AgentRuntimeProviderError {
  if (error instanceof AgentRuntimeProviderError) return error;
  if (timeout.aborted || isTimeoutAbort(signal))
    return new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true);
  if (signal?.aborted) return new AgentRuntimeProviderError('TURN_CANCELLED', false);
  return new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', true);
}

function providerHttpError(status: number): AgentRuntimeProviderError {
  if (status === 408 || status === 429 || status >= 500)
    return new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', true);
  return new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', false);
}

function responseRequestId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const requestId = (value as { _request_id?: unknown })._request_id;
  return typeof requestId === 'string' && requestId.length <= 200 ? requestId : null;
}

function responseUsage(value: unknown) {
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

async function validateComposerResponse(
  response: GroundedResponseSelectionV1,
  validate: AgentRuntimeComposerValidator | undefined,
) {
  if (!validate) return;
  try {
    await validate(response);
  } catch {
    // Treat semantic grounding rejection exactly like malformed structured
    // output so the ordered provider may make one safe fallback attempt.
    throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', true);
  }
}

async function validatePlannerResponse(
  plan: AgentPlanV1,
  validate: AgentRuntimePlannerValidator | undefined,
) {
  if (!validate) return;
  try {
    await validate(plan);
  } catch {
    throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', true);
  }
}

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

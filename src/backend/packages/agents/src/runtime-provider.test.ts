import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import type { AgentPlanV1, GroundedResponseSelectionV1 } from '@vda/contracts';
import { AgentRuntimeProviderError } from './runtime/providers/errors';
import { GeminiAgentRuntimeProvider } from './runtime/providers/gemini-provider';
import { OpenAIAgentRuntimeProvider } from './runtime/providers/openai-provider';
import { OrderedFallbackAgentRuntimeProvider } from './runtime/providers/fallback';
import {
  type AgentRuntimeComposerInput,
  type AgentRuntimePlannerInput,
  type AgentRuntimeProvider,
} from './runtime/providers/contracts';
import { XaiAgentRuntimeProvider } from './runtime/providers/xai-provider';

const runId = '50000000-0000-4000-8000-000000000001';
const plan: AgentPlanV1 = {
  version: 'agent-plan-v1',
  intent: 'inspect',
  steps: [
    {
      step_id: 'inspect-result',
      capability_id: 'get_analysis_result',
      input: { run_id: runId },
    },
  ],
  answer_mode: 'grounded',
  unsupported_reason: null,
};
const plannerInput: AgentRuntimePlannerInput = {
  question: 'What does this result show?',
  context: { allowed_run_ids: [runId] },
  capabilities: ['get_analysis_result'],
};
const unavailableResponse: GroundedResponseSelectionV1 = {
  version: 'grounded-response-selection-v1',
  status: 'unavailable',
  title_key: 'analysis_unavailable',
  blocks: [],
  workspace_action_ids: [],
  queued_run_ref: null,
  error_code: 'CAPABILITY_UNAVAILABLE',
};
const composerInput: AgentRuntimeComposerInput = {
  observations: [],
  available_workspace_actions: [],
};

function providerMetadata(provider: 'gemini' | 'openai' | 'xai') {
  return {
    provider,
    model: provider + '-fixture',
    request_id: null,
    latency_ms: 1,
    http_status: 200,
    zero_data_retention: null,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    fallback_from: null,
  };
}

function xaiResponse(value: unknown, headers?: HeadersInit) {
  return new Response(
    JSON.stringify({
      id: 'response-safe-id',
      model: 'grok-fixture',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(value) }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', ...headers } },
  );
}

describe('runtime providers', () => {
  it('uses a stateless strict xAI Responses request and locally validates the plan', async () => {
    let request: Record<string, unknown> | undefined;
    let url = '';
    let authorization = '';
    const provider = new XaiAgentRuntimeProvider({
      apiKey: 'test-xai-key',
      model: 'grok-fixture',
      baseUrl: 'https://api.x.ai/v1',
      timeoutMs: 100,
      fetchFn: async (input, init) => {
        url = String(input);
        request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        authorization = new Headers(init?.headers).get('authorization') ?? '';
        return xaiResponse(plan, { 'x-zero-data-retention': 'true', 'x-request-id': 'request-1' });
      },
      requireZdr: true,
    });

    await expect(provider.plan(plannerInput)).resolves.toMatchObject({
      value: plan,
      metadata: {
        provider: 'xai',
        model: 'grok-fixture',
        request_id: 'request-1',
        zero_data_retention: true,
        input_tokens: 10,
      },
    });
    expect(url).toBe('https://api.x.ai/v1/responses');
    expect(authorization).toBe('Bearer test-xai-key');
    expect(request).toMatchObject({
      model: 'grok-fixture',
      store: false,
      text: { format: { type: 'json_schema', name: 'agent_runtime_plan', strict: true } },
    });
    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('previous_response_id');
    expect(JSON.parse(String(request?.input))).toEqual({
      question: plannerInput.question,
      context: plannerInput.context,
      capabilities: plannerInput.capabilities,
    });
  });

  it('fails closed for malformed structured xAI output without exposing a body or key', async () => {
    const provider = new XaiAgentRuntimeProvider({
      apiKey: 'never-expose-this-key',
      model: 'grok-fixture',
      baseUrl: 'https://api.x.ai/v1',
      timeoutMs: 100,
      fetchFn: async () => xaiResponse({ ...plan, invented_field: 'nope' }),
      requireZdr: false,
    });
    await expect(provider.plan(plannerInput)).rejects.toMatchObject({
      code: 'PROVIDER_OUTPUT_INVALID',
      retryable: true,
      message: 'PROVIDER_OUTPUT_INVALID',
    });
  });

  it('uses the same strict stateless boundary for xAI composition', async () => {
    let request: Record<string, unknown> | undefined;
    const provider = new XaiAgentRuntimeProvider({
      apiKey: 'test-xai-key',
      model: 'grok-fixture',
      baseUrl: 'https://api.x.ai/v1',
      timeoutMs: 100,
      fetchFn: async (_input, init) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return xaiResponse(unavailableResponse);
      },
      requireZdr: false,
    });
    await expect(provider.compose(composerInput)).resolves.toMatchObject({
      value: unavailableResponse,
    });
    expect(request).toMatchObject({
      store: false,
      text: { format: { name: 'grounded_response_selection', strict: true } },
    });
    expect(request).not.toHaveProperty('tools');
    const composerRequest = JSON.parse(String(request?.input)) as Record<string, unknown>;
    expect(composerRequest).not.toHaveProperty('context');
    expect(composerRequest).toEqual(
      expect.objectContaining({
        observations: [],
        available_workspace_actions: [],
      }),
    );
  });

  it('classifies retryable xAI HTTP failures and requires the confirmed ZDR header when configured', async () => {
    const throttled = new XaiAgentRuntimeProvider({
      apiKey: 'test-xai-key',
      model: 'grok-fixture',
      baseUrl: 'https://api.x.ai/v1',
      timeoutMs: 100,
      fetchFn: async () => new Response('{}', { status: 429 }),
      requireZdr: false,
    });
    await expect(throttled.plan(plannerInput)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });

    const zdrRequired = new XaiAgentRuntimeProvider({
      apiKey: 'test-xai-key',
      model: 'grok-fixture',
      baseUrl: 'https://api.x.ai/v1',
      timeoutMs: 100,
      fetchFn: async () => xaiResponse(plan, { 'x-zero-data-retention': 'false' }),
      requireZdr: true,
    });
    await expect(zdrRequired.plan(plannerInput)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: false,
    });
    const missingZdr = new XaiAgentRuntimeProvider({
      apiKey: 'test-xai-key',
      model: 'grok-fixture',
      baseUrl: 'https://api.x.ai/v1',
      timeoutMs: 100,
      fetchFn: async () => xaiResponse(plan),
      requireZdr: true,
    });
    await expect(missingZdr.plan(plannerInput)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: false,
    });
  });

  it('distinguishes caller cancellation from a retryable transport failure', async () => {
    const cancelled = AbortSignal.abort();
    const provider = new XaiAgentRuntimeProvider({
      apiKey: 'test-xai-key',
      model: 'grok-fixture',
      baseUrl: 'https://api.x.ai/v1',
      timeoutMs: 100,
      fetchFn: async () => {
        throw new Error('transport unavailable');
      },
      requireZdr: false,
    });
    await expect(provider.plan(plannerInput, cancelled)).rejects.toMatchObject({
      code: 'TURN_CANCELLED',
      retryable: false,
    });
  });

  it('classifies an elapsed provider attempt as a retryable timeout', async () => {
    const provider = new XaiAgentRuntimeProvider({
      apiKey: 'test-xai-key',
      model: 'grok-fixture',
      baseUrl: 'https://api.x.ai/v1',
      timeoutMs: 10,
      fetchFn: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
      requireZdr: false,
    });
    await expect(provider.plan(plannerInput)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      retryable: true,
    });
  });

  it('uses the same bounded input for fallback and records only safe attempt metadata', async () => {
    let primaryInput: AgentRuntimePlannerInput | undefined;
    let fallbackInput: AgentRuntimePlannerInput | undefined;
    const unavailable: AgentRuntimeProvider = {
      provider: 'xai',
      model: 'grok-fixture',
      plan: async (input) => {
        primaryInput = input;
        throw new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true);
      },
      compose: async () => {
        throw new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true);
      },
    };
    const fallback: AgentRuntimeProvider = {
      provider: 'gemini',
      model: 'gemini-fixture',
      plan: async (input) => {
        fallbackInput = input;
        return {
          value: plan,
          metadata: {
            provider: 'gemini',
            model: 'gemini-fixture',
            request_id: null,
            latency_ms: 1,
            http_status: 200,
            zero_data_retention: null,
            input_tokens: null,
            output_tokens: null,
            total_tokens: null,
            fallback_from: null,
          },
        };
      },
      compose: async () => {
        throw new Error('not used');
      },
    };
    const events: unknown[] = [];
    const result = await new OrderedFallbackAgentRuntimeProvider([unavailable, fallback], (event) =>
      events.push(event),
    ).plan(plannerInput);
    expect(primaryInput).toBe(plannerInput);
    expect(fallbackInput).toBe(plannerInput);
    expect(result.metadata.fallback_from).toBe('xai');
    expect(events).toHaveLength(2);
    expect(events).toMatchObject([
      {
        stage: 'plan',
        attempt: 1,
        provider: 'xai',
        outcome: 'failed',
        error_code: 'PROVIDER_TIMEOUT',
      },
      { stage: 'plan', attempt: 2, provider: 'gemini', outcome: 'succeeded', error_code: null },
    ]);
    expect(JSON.stringify(events)).not.toContain(plannerInput.question);
  });

  it('does not begin a fallback attempt after the caller cancels', async () => {
    const controller = new AbortController();
    let fallbackCalled = false;
    const primary: AgentRuntimeProvider = {
      provider: 'xai',
      model: 'grok-fixture',
      plan: async () => {
        controller.abort();
        throw new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true);
      },
      compose: async () => {
        throw new Error('not used');
      },
    };
    const fallback: AgentRuntimeProvider = {
      provider: 'gemini',
      model: 'gemini-fixture',
      plan: async () => {
        fallbackCalled = true;
        throw new Error('not used');
      },
      compose: async () => {
        throw new Error('not used');
      },
    };
    await expect(
      new OrderedFallbackAgentRuntimeProvider([primary, fallback]).plan(
        plannerInput,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'TURN_CANCELLED', retryable: false });
    expect(fallbackCalled).toBe(false);
  });

  it('retries the configured composer when post-schema grounding validation rejects output', async () => {
    const inputs: AgentRuntimeComposerInput[] = [];
    const primary: AgentRuntimeProvider = {
      provider: 'xai',
      model: 'grok-fixture',
      plan: async () => {
        throw new Error('not used');
      },
      compose: async (input, _signal, validate) => {
        inputs.push(input);
        await validate?.(unavailableResponse);
        return { value: unavailableResponse, metadata: providerMetadata('xai') };
      },
    };
    const fallback: AgentRuntimeProvider = {
      provider: 'gemini',
      model: 'gemini-fixture',
      plan: async () => {
        throw new Error('not used');
      },
      compose: async (input, _signal, validate) => {
        inputs.push(input);
        await validate?.(unavailableResponse);
        return { value: unavailableResponse, metadata: providerMetadata('gemini') };
      },
    };
    const validator = vi
      .fn()
      .mockRejectedValueOnce(new Error('grounding invalid'))
      .mockResolvedValueOnce(undefined);

    const result = await new OrderedFallbackAgentRuntimeProvider([primary, fallback]).compose(
      composerInput,
      undefined,
      validator,
    );

    expect(result.metadata.fallback_from).toBe('xai');
    expect(validator).toHaveBeenCalledTimes(2);
    expect(inputs).toEqual([composerInput, composerInput]);
  });

  it('supports deterministic Gemini and OpenAI fixtures without vendor types escaping the interface', async () => {
    const gemini = new GeminiAgentRuntimeProvider(
      'gemini-key',
      'gemini-fixture',
      100,
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(gemini.plan(plannerInput)).resolves.toMatchObject({ value: plan });
    const geminiComposer = new GeminiAgentRuntimeProvider(
      'gemini-key',
      'gemini-fixture',
      100,
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(unavailableResponse) }] } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(geminiComposer.compose(composerInput)).resolves.toMatchObject({
      value: unavailableResponse,
    });

    const client = {
      responses: {
        parse: async (request: Record<string, unknown>) => {
          expect(request).toMatchObject({ store: false, model: 'openai-fixture' });
          const schemaName = (request.text as { format?: { name?: string } }).format?.name;
          return {
            output_parsed: schemaName === 'agent_runtime_plan' ? plan : unavailableResponse,
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          };
        },
      },
    } as unknown as OpenAI;
    const openai = new OpenAIAgentRuntimeProvider(client, 'openai-fixture', 100);
    await expect(openai.plan(plannerInput)).resolves.toMatchObject({ value: plan });
    await expect(openai.compose(composerInput)).resolves.toMatchObject({
      value: unavailableResponse,
      metadata: { provider: 'openai' },
    });
  });
});

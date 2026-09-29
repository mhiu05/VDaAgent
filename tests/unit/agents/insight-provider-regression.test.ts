import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Claim } from '@vda/contracts';
import {
  FallbackNarrativeProvider,
  GeminiProvider,
  OpenAIProvider,
} from '../../../src/backend/agents/providers/narrative';

const claims: Claim[] = Array.from({ length: 26 }, (_, index) => ({
  claim_id: `claim-${index}`,
  text: 'Synthetic inventory metric',
  metric_key: 'available_inventory',
  value: index,
  evidence_artifact_id: '10000000-0000-4000-8000-000000000001',
  evidence_path: `payload.metrics[${index}].value`,
}));
const output = JSON.stringify({
  summary_key: 'inventory_descriptive',
  claim_ids: claims.map((claim) => claim.claim_id),
});
const geminiResponse = (parts: object[]) => Response.json({ candidates: [{ content: { parts } }] });
const openaiResponse = (text: string) =>
  Response.json({
    id: 'fake-response',
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
  });
const sdkProvider = (fetch: typeof globalThis.fetch) =>
  new OpenAIProvider(
    new OpenAI({ apiKey: 'fake-key', fetch, timeout: 30_000, maxRetries: 1 }),
    'fake-model',
  );
async function aggregate(provider: GeminiProvider | OpenAIProvider): Promise<AggregateError> {
  try {
    await new FallbackNarrativeProvider([provider]).narrate(claims);
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    return error as AggregateError;
  }
  throw new Error('EXPECTED_PROVIDER_FAILURE');
}

beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('REAL_PROVIDER_FORBIDDEN');
    }),
  ),
);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Insight provider regressions without outbound requests', () => {
  it('identifies rejected credentials from both real HTTP adapters without retaining secrets', async () => {
    const primaryFetch = vi.fn<typeof fetch>(
      async () => new Response('PRIVATE_CREDENTIAL_SENTINEL', { status: 401 }),
    );
    const fallbackFetch = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          error: {
            message: 'PRIVATE_CREDENTIAL_SENTINEL',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        },
        { status: 401 },
      ),
    );
    const provider = new FallbackNarrativeProvider([
      new GeminiProvider('fake-key', 'fake-model', primaryFetch),
      sdkProvider(fallbackFetch),
    ]);
    const failure = (await provider
      .narrate(claims)
      .catch((error: unknown) => error)) as AggregateError;
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.message).toBe('LLM_AUTHENTICATION_FAILED');
    expect(failure.errors.map((error: Error) => error.message)).toEqual([
      'PROVIDER_HTTP_401',
      'PROVIDER_HTTP_401',
    ]);
    expect(failure.errors.map((error: { failure_reason: string }) => error.failure_reason)).toEqual(
      ['http_error', 'invalid_credentials'],
    );
    expect(primaryFetch).toHaveBeenCalledOnce();
    expect(fallbackFetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(failure.errors)).not.toContain('PRIVATE_CREDENTIAL_SENTINEL');
  });

  it('preserves mixed failures and still uses a healthy fallback after rejected primary credentials', async () => {
    const primary = new GeminiProvider(
      'fake-key',
      'fake-model',
      async () => new Response(null, { status: 401 }),
    );
    const mixed = new FallbackNarrativeProvider([
      primary,
      sdkProvider(async () => new Response(null, { status: 403 })),
    ]);
    await expect(mixed.narrate(claims)).rejects.toThrow('ALL_LLM_PROVIDERS_FAILED');
    await expect(
      new FallbackNarrativeProvider([
        primary,
        sdkProvider(async () => openaiResponse(output)),
      ]).narrate(claims),
    ).resolves.toMatchObject({ provider: 'openai', claims });
  });

  it.each([
    ['ACCESS_TOKEN_TYPE_UNSUPPORTED', 'unsupported_credentials'],
    ['API_KEY_INVALID', 'invalid_credentials'],
    ['PRIVATE_CREDENTIAL_SENTINEL', 'http_error'],
  ])('retains only the safe meaning of Gemini auth reason %s', async (reason, expected) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        {
          error: {
            code: 401,
            message: 'PRIVATE_CREDENTIAL_SENTINEL',
            status: 'UNAUTHENTICATED',
            details: [{ reason, metadata: { secret: 'PRIVATE_CREDENTIAL_SENTINEL' } }],
          },
        },
        { status: 401 },
      ),
    );
    const error = await aggregate(new GeminiProvider('AQ.fake-key', 'fake-model', fetch));
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-goog-api-key': 'AQ.fake-key' });
    expect(error.message).toBe('LLM_AUTHENTICATION_FAILED');
    expect(error.errors[0]).toMatchObject({
      message: 'PROVIDER_HTTP_401',
      failure_reason: expected,
    });
    expect(JSON.stringify(error.errors)).not.toContain('PRIVATE_CREDENTIAL_SENTINEL');
  });

  it('preserves the HTTP status when an authentication error body cannot be decoded', async () => {
    const error = await aggregate(
      new GeminiProvider(
        'fake-key',
        'fake-model',
        async () => new Response('not JSON', { status: 401 }),
      ),
    );
    expect(error.errors[0]).toMatchObject({
      message: 'PROVIDER_HTTP_401',
      failure_reason: 'http_error',
    });
  });

  it('assembles all structured text parts after thoughts without reaching the fallback', async () => {
    const primary = new GeminiProvider('fake-key', 'fake-model', async () =>
      geminiResponse([
        { thought: true, text: 'PRIVATE_THOUGHT_SENTINEL' },
        { text: output.slice(0, 80) },
        { text: output.slice(80) },
      ]),
    );
    const fallback = vi.fn(async () => {
      throw Object.assign(new Error('PRIVATE_RESPONSE_SENTINEL'), { status: 429 });
    });
    await expect(
      new FallbackNarrativeProvider([primary, { narrate: fallback }]).narrate(claims),
    ).resolves.toMatchObject({ provider: 'gemini', claims });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('does not assemble JSON across alternative candidates', async () => {
    const primary = new GeminiProvider('fake-key', 'fake-model', async () =>
      Response.json({
        candidates: [
          { content: { parts: [{ text: output.slice(0, 80) }] } },
          { content: { parts: [{ text: output.slice(80) }] } },
        ],
      }),
    );
    expect((await aggregate(primary)).errors.map((error: Error) => error.message)).toEqual([
      'GEMINI_RESPONSE_INVALID',
    ]);
  });

  it('retains Gemini HTTP status without retaining its body', async () => {
    const primary = new GeminiProvider(
      'fake-key',
      'fake-model',
      async () => new Response('PRIVATE_RESPONSE_SENTINEL', { status: 429 }),
    );
    expect((await aggregate(primary)).errors.map((error: Error) => error.message)).toEqual([
      'PROVIDER_HTTP_429',
    ]);
  });

  it.each(['request', 'body'])('classifies a Gemini %s timeout as a timeout', async (phase) => {
    const primary = new GeminiProvider('fake-key', 'fake-model', async () => {
      if (phase === 'request') throw new DOMException('PRIVATE_TIMEOUT_SENTINEL', 'TimeoutError');
      const response = geminiResponse([]);
      vi.spyOn(response, 'json').mockRejectedValue(
        new DOMException('PRIVATE_TIMEOUT_SENTINEL', 'TimeoutError'),
      );
      return response;
    });
    expect((await aggregate(primary)).errors.map((error: Error) => error.message)).toEqual([
      'PROVIDER_TIMEOUT',
    ]);
  });

  it('classifies malformed structured output thrown by the installed OpenAI parser', async () => {
    const provider = sdkProvider(async () => openaiResponse('{PRIVATE_RESPONSE_SENTINEL'));
    expect((await aggregate(provider)).errors.map((error: Error) => error.message)).toEqual([
      'PROVIDER_RESPONSE_INVALID',
    ]);
  });

  it('recognizes the installed SDK timeout class even though its name is Error', async () => {
    const error = new OpenAI.APIConnectionTimeoutError({ message: 'PRIVATE_TIMEOUT_SENTINEL' });
    expect(error.name).toBe('Error');
    const client = {
      responses: {
        parse: async () => {
          throw error;
        },
      },
    } as unknown as OpenAI;
    const failure = await aggregate(new OpenAIProvider(client, 'fake-model'));
    expect(failure.errors[0]).toMatchObject({
      message: 'PROVIDER_TIMEOUT',
      failure_reason: 'timeout',
    });
    expect(JSON.stringify(failure.errors)).not.toContain('PRIVATE_TIMEOUT_SENTINEL');
  });

  it('classifies an SDK connection error without retaining its cause', async () => {
    const error = new OpenAI.APIConnectionError({
      message: 'PRIVATE_RESPONSE_SENTINEL',
      cause: new Error('PRIVATE_CREDENTIAL_SENTINEL'),
    });
    const client = {
      responses: {
        parse: async () => {
          throw error;
        },
      },
    } as unknown as OpenAI;
    const failure = await aggregate(new OpenAIProvider(client, 'fake-model'));
    expect(failure.errors[0]).toMatchObject({
      message: 'PROVIDER_FAILED',
      failure_reason: 'request_failed',
    });
    expect(failure.errors[0].cause).toBeUndefined();
    expect(JSON.stringify(failure.errors)).not.toMatch(/PRIVATE|SENTINEL/);
  });

  it.each([
    ['no candidates', {}, 'GEMINI_RESPONSE_INVALID', 'empty_output'],
    [
      'thought only',
      { candidates: [{ content: { parts: [{ thought: true, text: output }] } }] },
      'GEMINI_RESPONSE_INVALID',
      'empty_output',
    ],
    [
      'blank output',
      { candidates: [{ content: { parts: [{ text: '  ' }] } }] },
      'GEMINI_RESPONSE_INVALID',
      'empty_output',
    ],
    [
      'invalid envelope',
      { candidates: 'PRIVATE_SENTINEL' },
      'GEMINI_RESPONSE_INVALID',
      'schema_mismatch',
    ],
    [
      'invalid JSON',
      { candidates: [{ content: { parts: [{ text: '{PRIVATE_SENTINEL' }] } }] },
      'GEMINI_RESPONSE_INVALID',
      'invalid_json',
    ],
    [
      'wrong schema',
      {
        candidates: [{ content: { parts: [{ text: '{"summary_key":"other","claim_ids":[]}' }] } }],
      },
      'GEMINI_RESPONSE_INVALID',
      'schema_mismatch',
    ],
    [
      'extra field',
      { candidates: [{ content: { parts: [{ text: output.slice(0, -1) + ',"extra":true}' }] } }] },
      'GEMINI_RESPONSE_INVALID',
      'schema_mismatch',
    ],
    [
      'missing claims',
      {
        candidates: [
          {
            content: {
              parts: [{ text: '{"summary_key":"inventory_descriptive","claim_ids":[]}' }],
            },
          },
        ],
      },
      'PROVIDER_UNGROUNDED_OUTPUT',
      'ungrounded_claims',
    ],
    [
      'truncated generation',
      { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: output }] } }] },
      'GEMINI_RESPONSE_INVALID',
      'incomplete_output',
    ],
  ])(
    'distinguishes Gemini %s without retaining raw responses',
    async (_label, body, code, reason) => {
      const error = await aggregate(
        new GeminiProvider('fake-key', 'fake-model', async () => Response.json(body)),
      );
      expect(error.errors).toHaveLength(1);
      expect(error.errors[0]).toMatchObject({ message: code, failure_reason: reason });
      expect(JSON.stringify(error.errors)).not.toContain('PRIVATE_SENTINEL');
    },
  );

  it.each([
    ['empty', { status: 'completed', output: [] }, 'empty_output'],
    [
      'refusal',
      {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'PRIVATE_SENTINEL' }] }],
      },
      'refusal',
    ],
    ['incomplete', { status: 'incomplete', output: [] }, 'incomplete_output'],
    [
      'schema mismatch',
      {
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '{"wrong":"PRIVATE_SENTINEL"}' }],
          },
        ],
      },
      'schema_mismatch',
    ],
  ])('distinguishes OpenAI %s output through the installed SDK', async (_label, body, reason) => {
    const error = await aggregate(
      sdkProvider(async () => Response.json({ id: 'fake-response', ...body })),
    );
    expect(error.errors[0]).toMatchObject({
      message: 'PROVIDER_RESPONSE_INVALID',
      failure_reason: reason,
    });
    expect(JSON.stringify(error.errors)).not.toContain('PRIVATE_SENTINEL');
  });

  it('passes the same constrained claims and context to a successful OpenAI fallback', async () => {
    let primaryInput: string | undefined;
    let primaryInstructions: string | undefined;
    const primary = new GeminiProvider('fake-key', 'fake-model', async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      primaryInput = request.contents[0].parts[0].text;
      primaryInstructions = request.systemInstruction.parts[0].text;
      return geminiResponse([]);
    });
    const fallbackFetch = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request).toMatchObject({
        input: primaryInput,
        instructions: primaryInstructions,
        store: false,
      });
      return openaiResponse(output);
    });
    await expect(
      new FallbackNarrativeProvider([primary, sdkProvider(fallbackFetch)]).narrate(claims, {
        instructions: 'Use only verified IDs.',
        context: { task: 'Synthetic inventory' },
      }),
    ).resolves.toMatchObject({ provider: 'openai', claims });
    expect(fallbackFetch).toHaveBeenCalledOnce();
  });

  it('classifies connection failure without logging the request or credential', async () => {
    const error = await aggregate(
      new GeminiProvider('fake-key', 'fake-model', async () => {
        throw new TypeError('PRIVATE_CREDENTIAL_SENTINEL');
      }),
    );
    expect(error.errors[0]).toMatchObject({
      message: 'GEMINI_REQUEST_FAILED',
      failure_reason: 'request_failed',
    });
    expect(JSON.stringify(error.errors)).not.toContain('PRIVATE_CREDENTIAL_SENTINEL');
  });

  it('rejects an oversized context before either provider is called', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const primary = new GeminiProvider('fake-key', 'fake-model', fetch);
    const provider = new FallbackNarrativeProvider([primary, sdkProvider(fetch)]);
    const error = await provider
      .narrate(claims, { instructions: 'Use IDs', context: { text: 'x'.repeat(32_000) } })
      .catch((error) => error);
    expect(error.errors.map((error: Error) => error.message)).toEqual([
      'NARRATIVE_CONTEXT_LIMIT',
      'NARRATIVE_CONTEXT_LIMIT',
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('honors the 30-second Gemini deadline and then uses a valid fallback', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Synthetic timeout', 'TimeoutError')), ms);
      return controller.signal;
    });
    const primary = new GeminiProvider(
      'fake-key',
      'fake-model',
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {
            once: true,
          });
        }),
    );
    const fallbackFetch = vi.fn<typeof fetch>(async () => openaiResponse(output));
    const pending = new FallbackNarrativeProvider([primary, sdkProvider(fallbackFetch)]).narrate(
      claims,
    );
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fallbackFetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ provider: 'openai', claims });
    expect(timeout).toHaveBeenCalledWith(30_000);
  });

  it('does not call fallback when the owning execution is cancelled', async () => {
    const controller = new AbortController();
    const primary = new GeminiProvider('fake-key', 'fake-model', async () => {
      controller.abort();
      throw new DOMException('Cancelled', 'AbortError');
    });
    const fallback = vi.fn();
    await expect(
      new FallbackNarrativeProvider([primary, { narrate: fallback }]).narrate(claims, {
        instructions: 'Use IDs',
        context: {},
        signal: controller.signal,
      }),
    ).rejects.toThrow('NARRATIVE_CANCELLED');
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'accounts for 25s + 29s deterministically (valid Gemini output: %s)',
    async (valid) => {
      vi.useFakeTimers();
      const primary = new GeminiProvider('fake-key', 'fake-model', async () => {
        await new Promise((resolve) => setTimeout(resolve, 25_000));
        return geminiResponse([
          { thought: true, text: 'PRIVATE_THOUGHT_SENTINEL' },
          ...(valid ? [{ text: output.slice(0, 80) }, { text: output.slice(80) }] : []),
        ]);
      });
      const fallbackFetch = vi.fn<typeof fetch>(async () => {
        await new Promise((resolve) => setTimeout(resolve, 29_000));
        return new Response('PRIVATE_RESPONSE_SENTINEL', { status: 401 });
      });
      const started = Date.now();
      const pending = new FallbackNarrativeProvider([primary, sdkProvider(fallbackFetch)])
        .narrate(claims)
        .then(
          (value) => ({ value, error: null, elapsed: Date.now() - started }),
          (error) => ({ value: null, error, elapsed: Date.now() - started }),
        );
      await vi.advanceTimersByTimeAsync(54_000);
      const settled = await pending;
      if (valid) {
        expect(settled.value).toMatchObject({ provider: 'gemini', claims });
        expect(settled.elapsed).toBe(25_000);
        expect(fallbackFetch).not.toHaveBeenCalled();
      } else {
        expect(settled.elapsed).toBe(54_000);
        expect(settled.error).toMatchObject({ message: 'ALL_LLM_PROVIDERS_FAILED' });
        expect(settled.error.errors).toMatchObject([
          {
            message: 'GEMINI_RESPONSE_INVALID',
            failure_reason: 'empty_output',
            duration_ms: 25_000,
          },
          { message: 'PROVIDER_HTTP_401', failure_reason: 'http_error', duration_ms: 29_000 },
        ]);
        expect(fallbackFetch).toHaveBeenCalledOnce();
      }
    },
  );
});

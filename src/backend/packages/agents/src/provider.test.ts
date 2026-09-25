import { describe, expect, it } from 'vitest';
import type { Claim } from '@vda/contracts';
import {
  FallbackAgentDecisionProvider,
  GeminiAgentDecisionProvider,
  type AgentDecisionProvider,
} from './chat/legacy/provider';
import {
  FallbackNarrativeProvider,
  GeminiProvider,
  type NarrativeProvider,
} from './legacy-workflow/narrative/provider';

const claims: Claim[] = [
  {
    claim_id: 'claim-available',
    text: 'Available inventory: 10 units.',
    metric_key: 'available_inventory',
    value: 10,
    evidence_artifact_id: '10000000-0000-4000-8000-000000000001',
    evidence_path: 'payload.metrics[0].value',
  },
];

describe('narrative providers', () => {
  it('sends constrained JSON to Gemini and returns only grounded claims', async () => {
    let request: Record<string, unknown> | undefined;
    const provider = new GeminiProvider('test-key', 'gemini-test', async (_input, init) => {
      request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary_key: 'inventory_descriptive',
                      claim_ids: ['claim-available'],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    await expect(provider.narrate(claims)).resolves.toMatchObject({
      provider: 'gemini',
      claims,
    });
    expect(request).toMatchObject({
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
      },
    });
  });

  it('uses OpenAI only after Gemini cannot produce a usable result', async () => {
    const unavailable: NarrativeProvider = {
      narrate: async () => {
        throw new Error('GEMINI_REQUEST_FAILED');
      },
    };
    const openai: NarrativeProvider = {
      narrate: async (input) => ({
        summary: 'validated summary',
        claims: input,
        provider: 'openai',
      }),
    };

    await expect(
      new FallbackNarrativeProvider([unavailable, openai]).narrate(claims),
    ).resolves.toMatchObject({
      provider: 'openai',
      claims,
    });
  });

  it.each([
    ['invented claim', ['invented-claim']],
    ['duplicate claim', ['claim-available', 'claim-available']],
    ['missing claim', []],
  ])('rejects %s IDs from structured provider output', async (_label, claimIds) => {
    const provider = new GeminiProvider('test-key', 'gemini-test', async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        summary_key: 'inventory_descriptive',
                        claim_ids: claimIds,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    await expect(provider.narrate(claims)).rejects.toThrow('PROVIDER_UNGROUNDED_OUTPUT');
  });
});

describe('Agent Chat decision providers', () => {
  const context = {
    question: 'Show inventory',
    scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
    data_as_of: '2026-09-19',
    scope_changed: false,
    date_changed: false,
    role: 'owner' as const,
    catalog: {
      projects: [
        {
          project_external_id: 'P-ALPHA',
          zones: [{ zone_external_id: 'Z-NORTH', zone_name: 'North' }],
        },
      ],
      latest_snapshot_date: '2026-09-19',
    },
    recent_messages: [],
    allowed_run_ids: [],
    active_brief: null,
    requested_signal_ref: null,
  };
  it('rejects unknown fields from a structured Gemini decision', async () => {
    const provider = new GeminiAgentDecisionProvider(
      'test-key',
      'gemini-test',
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        action: 'create_analysis',
                        focus: 'current_inventory',
                        sql: 'select 1',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(provider.decide(context)).rejects.toThrow('GEMINI_AGENT_RESPONSE_INVALID');
  });

  it('passes the same bounded context to its fallback provider', async () => {
    const unavailable: AgentDecisionProvider = {
      decide: async () => {
        throw new Error('unavailable');
      },
    };
    const fallback: AgentDecisionProvider = {
      decide: async (input) => {
        expect(input).toEqual(context);
        return { action: 'unsupported', reason_code: 'UNSUPPORTED_REQUEST' };
      },
    };
    await expect(
      new FallbackAgentDecisionProvider([unavailable, fallback]).decide(context),
    ).resolves.toEqual({
      action: 'unsupported',
      reason_code: 'UNSUPPORTED_REQUEST',
    });
  });
});

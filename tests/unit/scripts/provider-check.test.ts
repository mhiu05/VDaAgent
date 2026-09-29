import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider, type NarrativeProvider } from '@vda/agents';
import { checkNarrativeProviders } from '../../../scripts/lib/provider-check';

const models = { gemini: 'test-gemini', openai: 'test-openai' };
const healthy = (provider: 'gemini' | 'openai'): NarrativeProvider => ({
  narrate: vi.fn(async (claims) => ({ summary: 'Synthetic check', claims, provider })),
});

describe('standalone provider connection checks', () => {
  it('checks both providers even when the primary succeeds', async () => {
    const providers = { gemini: healthy('gemini'), openai: healthy('openai') };
    const results = await checkNarrativeProviders(providers, models);
    expect(results.map((result) => [result.provider, result.status])).toEqual([
      ['gemini', 'ok'],
      ['openai', 'ok'],
    ]);
    expect(providers.gemini.narrate).toHaveBeenCalledOnce();
    expect(providers.openai.narrate).toHaveBeenCalledOnce();
  });

  it('classifies rejected credentials without leaking provider response bodies', async () => {
    const gemini = new GeminiProvider('AQ.test', models.gemini, async () =>
      Response.json(
        {
          error: {
            message: 'PRIVATE_KEY_SENTINEL',
            details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }],
          },
        },
        { status: 401 },
      ),
    );
    const openai: NarrativeProvider = {
      narrate: async () => {
        throw Object.assign(new Error('PRIVATE_KEY_SENTINEL'), {
          status: 401,
          code: 'invalid_api_key',
        });
      },
    };
    const results = await checkNarrativeProviders({ gemini, openai }, models);
    expect(results[0]).toMatchObject({
      status: 'failed',
      provider_failure_reasons: ['unsupported_credentials'],
    });
    expect(results[1]).toMatchObject({
      status: 'failed',
      provider_failure_reasons: ['invalid_credentials'],
    });
    expect(JSON.stringify(results)).not.toContain('PRIVATE_KEY_SENTINEL');
  });

  it('still checks the fallback after an unexpected primary failure', async () => {
    const results = await checkNarrativeProviders(
      {
        gemini: {
          narrate: async () => {
            throw new Error('PRIVATE_KEY_SENTINEL');
          },
        },
        openai: healthy('openai'),
      },
      models,
    );
    expect(results.map((result) => result.status)).toEqual(['failed', 'ok']);
    expect(JSON.stringify(results)).not.toContain('PRIVATE_KEY_SENTINEL');
  });
});

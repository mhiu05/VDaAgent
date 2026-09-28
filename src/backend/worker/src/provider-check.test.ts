import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider, type NarrativeProvider } from '@vda/agents';
import { checkNarrativeProviders } from './provider-check';

const models = { gemini: 'test-gemini', openai: 'test-openai' };
const healthy = (provider: 'gemini' | 'openai'): NarrativeProvider => ({
  narrate: vi.fn(async claims => ({ summary: 'Synthetic connection check', claims, provider })),
});

describe('standalone provider connection check', () => {
  it('checks both providers even when the primary is healthy', async () => {
    const providers = { gemini: healthy('gemini'), openai: healthy('openai') };
    const results = await checkNarrativeProviders(providers, models);
    expect(results).toEqual([
      { provider: 'gemini', model: models.gemini, status: 'ok', duration_ms: expect.any(Number) },
      { provider: 'openai', model: models.openai, status: 'ok', duration_ms: expect.any(Number) },
    ]);
    expect(providers.gemini.narrate).toHaveBeenCalledOnce();
    expect(providers.openai.narrate).toHaveBeenCalledOnce();
  });

  it('distinguishes unsupported Gemini credentials from an invalid OpenAI key without leaking bodies', async () => {
    const gemini = new GeminiProvider('AQ.test', models.gemini, async () => Response.json({ error: {
      message: 'PRIVATE_KEY_SENTINEL', details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }],
    } }, { status: 401 }));
    const openai: NarrativeProvider = { narrate: async () => {
      throw Object.assign(new Error('PRIVATE_KEY_SENTINEL'), { status: 401, code: 'invalid_api_key' });
    } };
    const results = await checkNarrativeProviders({ gemini, openai }, models);
    expect(results[0]).toMatchObject({ status: 'failed', provider_failure_codes: ['PROVIDER_HTTP_401'], provider_failure_reasons: ['unsupported_credentials'] });
    expect(results[1]).toMatchObject({ status: 'failed', provider_failure_codes: ['PROVIDER_HTTP_401'], provider_failure_reasons: ['invalid_credentials'] });
    expect(JSON.stringify(results)).not.toContain('PRIVATE_KEY_SENTINEL');
  });

  it('still tests the fallback when the primary fails with an unexpected error', async () => {
    const results = await checkNarrativeProviders({
      gemini: { narrate: async () => { throw new Error('PRIVATE_KEY_SENTINEL'); } }, openai: healthy('openai'),
    }, models);
    expect(results[0]).toMatchObject({ status: 'failed', provider_failure_codes: ['PROVIDER_FAILED'] });
    expect(results[1]).toMatchObject({ status: 'ok' });
    expect(JSON.stringify(results)).not.toContain('PRIVATE_KEY_SENTINEL');
  });
});

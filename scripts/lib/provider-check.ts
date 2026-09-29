import { FallbackNarrativeProvider, type NarrativeProvider } from '@vda/agents';
import type { LlmProvider } from '@vda/config';
import { errorDiagnostics } from '../../src/backend/worker/error-diagnostics';

// A synthetic claim exercises the exact structured Insight contract. No user
// data, database access, workflow writes or report publication are involved.
const probeClaims: Parameters<NarrativeProvider['narrate']>[0] = [
  {
    claim_id: 'connection-check',
    text: 'Synthetic connection check',
    metric_key: 'available_inventory',
    value: 1,
    evidence_artifact_id: '00000000-0000-4000-8000-000000000001',
    evidence_path: 'payload.metrics[0].value',
  },
];

/** Test each configured provider independently, including the fallback. */
export async function checkNarrativeProviders(
  providers: Record<LlmProvider, NarrativeProvider>,
  models: Record<LlmProvider, string>,
) {
  return Promise.all(
    (['gemini', 'openai'] as const).map(async (provider) => {
      const started = Date.now();
      try {
        await new FallbackNarrativeProvider([providers[provider]]).narrate(probeClaims);
        return {
          provider,
          model: models[provider],
          status: 'ok' as const,
          duration_ms: Date.now() - started,
        };
      } catch (error) {
        return {
          provider,
          model: models[provider],
          status: 'failed' as const,
          duration_ms: Date.now() - started,
          ...errorDiagnostics(error),
        };
      }
    }),
  );
}

import { createNarrativeProviders } from '@vda/agents';
import { getConfig } from '@vda/config';
import { checkNarrativeProviders } from './lib/provider-check';

try {
  const config = getConfig();
  const results = await checkNarrativeProviders(createNarrativeProviders(config), {
    gemini: config.GEMINI_MODEL!,
    openai: config.OPENAI_MODEL!,
  });
  console.log(JSON.stringify({ checked_at: new Date().toISOString(), results }, null, 2));
  if (results.some((result) => result.status !== 'ok')) process.exitCode = 1;
} catch {
  // Configuration validation may include secret values. Never print its error.
  console.error('LLM_CHECK_CONFIGURATION_INVALID');
  process.exitCode = 1;
}

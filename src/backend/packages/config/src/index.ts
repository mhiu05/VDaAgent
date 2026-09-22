import { z } from 'zod';

export const LlmProviderSchema = z.enum(['gemini', 'openai']);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

const ConfigSchema = z.object({
  APP_MODE: z.literal('supabase').default('supabase'),
  LLM_PRIMARY_PROVIDER: LlmProviderSchema,
  LLM_FALLBACK_PROVIDER: LlmProviderSchema,
  GEMINI_MODEL: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  SUPABASE_DB_URL: z.url(),
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  DEVELOPMENT_ROLE_BYPASS: z.enum(['true', 'false']).optional(),
  AGENT_WORKFLOW_ENABLED: z.enum(['true', 'false']).default('false'),
});
export function getConfig(env: NodeJS.ProcessEnv = process.env) {
  const normalized = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const value = ConfigSchema.parse(normalized);
  const developmentRoleBypass =
    value.DEVELOPMENT_ROLE_BYPASS === undefined
      ? env.NODE_ENV === 'development'
      : value.DEVELOPMENT_ROLE_BYPASS === 'true';
  if (developmentRoleBypass && env.NODE_ENV === 'production')
    throw new Error('DEVELOPMENT_ROLE_BYPASS cannot be enabled in production.');
  if (!['postgres:', 'postgresql:'].includes(new URL(value.SUPABASE_DB_URL).protocol))
    throw new Error('SUPABASE_DB_URL must be a PostgreSQL connection string.');
  if (env.LLM_MODE)
    throw new Error(
      'LLM_MODE is no longer supported. Set LLM_PRIMARY_PROVIDER=gemini and LLM_FALLBACK_PROVIDER=openai.',
    );
  if (value.LLM_PRIMARY_PROVIDER !== 'gemini' || value.LLM_FALLBACK_PROVIDER !== 'openai') {
    throw new Error(
      'This deployment requires LLM_PRIMARY_PROVIDER=gemini and LLM_FALLBACK_PROVIDER=openai.',
    );
  }
  if (!value.GEMINI_API_KEY || !value.GEMINI_MODEL) {
    throw new Error('Gemini requires GEMINI_API_KEY and GEMINI_MODEL.');
  }
  if (!value.OPENAI_API_KEY || !value.OPENAI_MODEL) {
    throw new Error('OpenAI fallback requires OPENAI_API_KEY and OPENAI_MODEL.');
  }
  for (const name of Object.keys(env)) {
    if (
      name.startsWith('NEXT_PUBLIC_') &&
      /SECRET|PASSWORD|DATABASE|DB_URL|API_KEY/.test(name) &&
      env[name]
    )
      throw new Error('Server secret may not have NEXT_PUBLIC_ prefix.');
  }
  return {
    ...value,
    DEVELOPMENT_ROLE_BYPASS: developmentRoleBypass,
    AGENT_WORKFLOW_ENABLED: value.AGENT_WORKFLOW_ENABLED === 'true',
  };
}
export type AppConfig = ReturnType<typeof getConfig>;

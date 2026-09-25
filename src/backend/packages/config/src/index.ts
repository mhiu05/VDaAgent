import { z } from 'zod';

export const LlmProviderSchema = z.enum(['gemini', 'openai']);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;
export const AgentRuntimeProviderSchema = z.enum(['gemini', 'openai', 'xai']);
export type AgentRuntimeProvider = z.infer<typeof AgentRuntimeProviderSchema>;

const BooleanFlagSchema = z.enum(['true', 'false']);
const RuntimeTimeoutSchema = z.coerce.number().int().min(1_000).max(45_000);

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
  AGENT_WORKFLOW_ENABLED: BooleanFlagSchema.default('false'),
  DURABLE_AGENT_EXECUTION_ENABLED: BooleanFlagSchema.default('false'),
  GROK_RUNTIME_ENABLED: BooleanFlagSchema.default('false'),
  GROK_WORKSPACE_ENABLED: BooleanFlagSchema.default('false'),
  GROK_SSE_ENABLED: BooleanFlagSchema.default('false'),
  // The runtime follows the established provider ordering. xAI remains an
  // opt-in adapter and is never required for the P0 control plane.
  AGENT_LLM_PRIMARY_PROVIDER: AgentRuntimeProviderSchema.default('gemini'),
  AGENT_LLM_FALLBACK_PROVIDER: AgentRuntimeProviderSchema.default('openai'),
  AGENT_PROVIDER_TIMEOUT_MS: RuntimeTimeoutSchema.default(12_000),
  AGENT_TURN_TIMEOUT_MS: RuntimeTimeoutSchema.default(45_000),
  XAI_API_KEY: z.string().min(1).optional(),
  XAI_MODEL: z.string().min(1).optional(),
  XAI_BASE_URL: z.url().default('https://api.x.ai/v1'),
  XAI_REQUIRE_ZDR: BooleanFlagSchema.default('false'),
});

function validateXaiBaseUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  // URL normalizes an explicit default port (for example, :443) away, so
  // inspect the original authority as well as the parsed URL.
  const suppliedAuthority = baseUrl.match(/^https:\/\/([^\/?#]+)/i)?.[1] ?? '';
  if (
    url.protocol !== 'https:' ||
    !['api.x.ai', 'us.api.x.ai'].includes(url.hostname) ||
    url.port ||
    /^(?:api\.x\.ai|us\.api\.x\.ai):/i.test(suppliedAuthority) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['/v1', '/v1/'].includes(url.pathname)
  )
    throw new Error('XAI_BASE_URL must use an approved xAI HTTPS /v1 endpoint in production.');
}
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
  const runtimeEnabled = value.GROK_RUNTIME_ENABLED === 'true';
  if (runtimeEnabled) {
    if (value.AGENT_LLM_PRIMARY_PROVIDER === value.AGENT_LLM_FALLBACK_PROVIDER)
      throw new Error('AGENT_LLM_PRIMARY_PROVIDER and AGENT_LLM_FALLBACK_PROVIDER must differ.');
    if (
      (value.AGENT_LLM_PRIMARY_PROVIDER === 'xai' ||
        value.AGENT_LLM_FALLBACK_PROVIDER === 'xai') &&
      (!value.XAI_API_KEY || !value.XAI_MODEL)
    )
      throw new Error('xAI runtime provider requires XAI_API_KEY and XAI_MODEL.');
    if (value.AGENT_PROVIDER_TIMEOUT_MS > value.AGENT_TURN_TIMEOUT_MS)
      throw new Error('AGENT_PROVIDER_TIMEOUT_MS cannot exceed AGENT_TURN_TIMEOUT_MS.');
    if (
      env.NODE_ENV === 'production' &&
      (value.AGENT_LLM_PRIMARY_PROVIDER === 'xai' ||
        value.AGENT_LLM_FALLBACK_PROVIDER === 'xai')
    )
      validateXaiBaseUrl(value.XAI_BASE_URL);
  }
  for (const name of Object.keys(env)) {
    if (
      name.startsWith('NEXT_PUBLIC_') &&
      (/SECRET|PASSWORD|DATABASE|DB_URL|API_KEY/.test(name) ||
        /^(NEXT_PUBLIC_)(GROK_|AGENT_|XAI_)/.test(name)) &&
      env[name]
    )
      throw new Error('Server secret may not have NEXT_PUBLIC_ prefix.');
  }
  return {
    ...value,
    DEVELOPMENT_ROLE_BYPASS: developmentRoleBypass,
    AGENT_WORKFLOW_ENABLED: value.AGENT_WORKFLOW_ENABLED === 'true',
    DURABLE_AGENT_EXECUTION_ENABLED: value.DURABLE_AGENT_EXECUTION_ENABLED === 'true',
    GROK_RUNTIME_ENABLED: runtimeEnabled,
    GROK_WORKSPACE_ENABLED: value.GROK_WORKSPACE_ENABLED === 'true',
    GROK_SSE_ENABLED: value.GROK_SSE_ENABLED === 'true',
    XAI_REQUIRE_ZDR: value.XAI_REQUIRE_ZDR === 'true',
  };
}
export type AppConfig = ReturnType<typeof getConfig>;

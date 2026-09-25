import { cookies } from 'next/headers';
import { LoginSchema, SessionSchema, SetupSchema } from '@vda/contracts';
import { RepositoryError, type Repository } from '@vda/db';
import { getConfig } from '@vda/config';
import {
  DEVELOPMENT_ROLE_COOKIE,
  developmentPrincipal,
  repository,
  signGrant,
  supabaseClient,
} from '../../context';
import { body as readBody } from '../middleware/request-body';
import { json } from '../middleware/response';
import { DevelopmentRoleBody, OkSchema } from './schemas';

export async function authRoute(
  request: Request,
  method: string,
  route: string,
): Promise<Response | null> {
  if (route === 'setup' && method === 'GET') {
    try {
      const config = getConfig();
      return json(SetupSchema, {
        mode: 'supabase',
        llm_primary_provider: config.LLM_PRIMARY_PROVIDER,
        llm_fallback_provider: config.LLM_FALLBACK_PROVIDER,
        grok_runtime_enabled: config.GROK_RUNTIME_ENABLED,
        grok_workspace_enabled: config.GROK_WORKSPACE_ENABLED,
        grok_sse_enabled: config.GROK_SSE_ENABLED,
        development_role_bypass: config.DEVELOPMENT_ROLE_BYPASS,
        ready: true,
        message: config.DEVELOPMENT_ROLE_BYPASS
          ? 'Chế độ development: chọn vai trò để vào workspace.'
          : 'Supabase Auth, PostgreSQL và workspace isolation đã được cấu hình.',
      });
    } catch {
      return json(SetupSchema, {
        mode: 'supabase',
        llm_primary_provider: process.env.LLM_PRIMARY_PROVIDER === 'openai' ? 'openai' : 'gemini',
        llm_fallback_provider: process.env.LLM_FALLBACK_PROVIDER === 'gemini' ? 'gemini' : 'openai',
        grok_runtime_enabled: false,
        grok_workspace_enabled: false,
        grok_sse_enabled: false,
        development_role_bypass: false,
        ready: false,
        message: 'Thiếu cấu hình Supabase. Xem docs/LOCAL_CONFIGURATION.md.',
      });
    }
  }

  if (route === 'auth/login' && method === 'POST') {
    if (getConfig().DEVELOPMENT_ROLE_BYPASS)
      throw new RepositoryError('DEVELOPMENT_ROLE_BYPASS_ACTIVE', 409);
    const input = LoginSchema.parse(await readBody(request));
    const client = await supabaseClient();
    const { data, error } = await client.auth.signInWithPassword(input);
    if (error || !data.user || !data.user.email) throw new RepositoryError('LOGIN_FAILED', 401);
    return json(SessionSchema, await (await repository()).session(data.user.id, data.user.email));
  }

  if (route === 'auth/development-role' && method === 'POST') {
    const config = getConfig();
    if (!config.DEVELOPMENT_ROLE_BYPASS)
      throw new RepositoryError('DEVELOPMENT_ROLE_BYPASS_DISABLED', 404);
    const input = DevelopmentRoleBody.parse(await readBody(request));
    const expires = Date.now() + 8 * 60 * 60_000;
    (await cookies()).set(DEVELOPMENT_ROLE_COOKIE, signGrant({ role: input.role, expires }), {
      httpOnly: true,
      maxAge: 8 * 60 * 60,
      path: '/',
      sameSite: 'strict',
      secure: new URL(request.url).protocol === 'https:',
    });
    const actor = developmentPrincipal(input.role);
    return json(SessionSchema, await (await repository()).session(actor.user_id, actor.email));
  }

  if (route === 'auth/logout' && method === 'POST') {
    (await cookies()).set(DEVELOPMENT_ROLE_COOKIE, '', { maxAge: 0, path: '/' });
    if (!getConfig().DEVELOPMENT_ROLE_BYPASS) await (await supabaseClient()).auth.signOut();
    return json(OkSchema, { ok: true });
  }
  return null;
}

export async function sessionRoute(
  repo: Repository,
  actor: { user_id: string; email: string },
  method: string,
  route: string,
): Promise<Response | null> {
  if (route === 'session' && method === 'GET')
    return json(SessionSchema, await repo.session(actor.user_id, actor.email));
  return null;
}

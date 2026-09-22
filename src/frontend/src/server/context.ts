import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { RoleSchema, type Role } from '@vda/contracts';
import { getConfig } from '@vda/config';
import { createRepository, RepositoryError, type Repository } from '@vda/db';
import { z } from 'zod';

export const DEVELOPMENT_ROLE_COOKIE = 'vda_development_role';
const DevelopmentGrantSchema = z
  .object({ role: RoleSchema, expires: z.number().finite() })
  .strict();
const DEVELOPMENT_PRINCIPALS: Record<Role, { user_id: string; email: string }> = {
  owner: {
    user_id: '20000000-0000-4000-8000-000000000001',
    email: 'owner@vda.example.test',
  },
  analyst: {
    user_id: '20000000-0000-4000-8000-000000000002',
    email: 'analyst@vda.example.test',
  },
  viewer: {
    user_id: '20000000-0000-4000-8000-000000000003',
    email: 'viewer@vda.example.test',
  },
};
const globalState = globalThis as typeof globalThis & {
  vdaRepository?: Promise<Repository>;
  vdaSigningKey?: Buffer;
};
export function repository(): Promise<Repository> {
  const config = getConfig();
  globalState.vdaRepository ??= createRepository({
    databaseUrl: config.SUPABASE_DB_URL,
    storageUrl: config.NEXT_PUBLIC_SUPABASE_URL,
    storageKey: config.SUPABASE_SECRET_KEY,
    workflowVersion: config.AGENT_WORKFLOW_ENABLED ? 'agent-v1' : 'legacy-v1',
  });
  return globalState.vdaRepository;
}
function signingKey(): Buffer {
  return (globalState.vdaSigningKey ??= randomBytes(32));
}
export function signGrant(value: object): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${body}.${createHmac('sha256', signingKey()).update(body).digest('base64url')}`;
}
export function readGrant<T>(token: string): T {
  const parts = token.split('.');
  if (parts.length !== 2) throw new RepositoryError('INVALID_GRANT', 401);
  const expected = createHmac('sha256', signingKey()).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new RepositoryError('INVALID_GRANT', 401);
  const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (!Number.isFinite(value.expires) || value.expires <= Date.now())
    throw new RepositoryError('EXPIRED_GRANT', 401);
  return value as T;
}
export function developmentPrincipal(role: Role): { user_id: string; email: string } {
  return DEVELOPMENT_PRINCIPALS[role];
}
export async function supabaseClient() {
  const config = getConfig();
  const jar = await cookies();
  return createServerClient(
    config.NEXT_PUBLIC_SUPABASE_URL!,
    config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          values.forEach(({ name, value, options }) => jar.set(name, value, options));
        },
      },
    },
  );
}
export async function principal(): Promise<{ user_id: string; email: string }> {
  if (getConfig().DEVELOPMENT_ROLE_BYPASS) {
    const token = (await cookies()).get(DEVELOPMENT_ROLE_COOKIE)?.value;
    if (!token) throw new RepositoryError('AUTH_REQUIRED', 401);
    const grant = DevelopmentGrantSchema.safeParse(readGrant<unknown>(token));
    if (!grant.success) throw new RepositoryError('INVALID_GRANT', 401);
    return developmentPrincipal(grant.data.role);
  }
  const client = await supabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new RepositoryError('AUTH_REQUIRED', 401);
  if (!data.user.email) throw new RepositoryError('AUTH_EMAIL_REQUIRED', 401);
  return { user_id: data.user.id, email: data.user.email };
}

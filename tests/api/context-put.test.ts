import { describe, expect, it, vi } from 'vitest';
import { ThreadContextSchema } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { runtimeWorkspaceRoutes } from '../../src/frontend/server/api/routes/runtime-workspace';
import type { AuthenticatedRouteContext } from '../../src/frontend/server/api/routes/route-context';

const orgId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const conversationId = '90000000-0000-4000-8000-000000000001';

describe('conversation context PUT', () => {
  it('parses the body and forwards signed user and selected tenant to persistence', async () => {
    const value = ThreadContextSchema.parse({});
    const updateThreadContext = vi.fn().mockResolvedValue(value);
    const path = ['conversations', conversationId, 'context'];
    const url = new URL(`http://localhost/api/${path.join('/')}?org_id=${orgId}`);
    const request = new Request(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
    const context = {
      path,
      route: path.join('/'),
      method: 'PUT',
      request,
      url,
      repo: { updateThreadContext } as unknown as Repository,
      actor: { user_id: userId, email: 'owner@example.test' },
      orgFromQuery: () => orgId,
    } as AuthenticatedRouteContext;

    const response = await runtimeWorkspaceRoutes(context);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual(value);
    expect(updateThreadContext).toHaveBeenCalledOnce();
    expect(updateThreadContext).toHaveBeenCalledWith(userId, orgId, conversationId, value);
  });
});

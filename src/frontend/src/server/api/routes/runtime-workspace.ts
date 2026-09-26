import { z } from 'zod';
import {
  AgentDefinitionSchema, IdSchema, MemoryEntrySchema, RunRuntimeSnapshotSchema,
  ThreadContextSchema,
} from '@vda/contracts';
import { ANALYSIS_AGENT_DEFINITIONS } from '@vda/agents';
import { RepositoryError } from '@vda/db';
import { durableEventStream } from '../../durable-event-stream';
import { body } from '../middleware/request-body';
import { json } from '../middleware/response';
import type { AuthenticatedRouteContext } from './route-context';

export function eventCursor(request: Request, url: URL) {
  return z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
    .parse(request.headers.get('last-event-id') ?? url.searchParams.get('after') ?? '0');
}

export function assertStreamAccept(request: Request) {
  if (!request.headers.get('accept')?.includes('text/event-stream'))
    throw new RepositoryError('SSE_ACCEPT_REQUIRED', 406);
}

export async function runtimeWorkspaceRoutes(context: AuthenticatedRouteContext): Promise<Response | null> {
  const { path, route, method, request, url, repo, actor, orgFromQuery } = context;
  if (route === 'agent-definitions' && method === 'GET') {
    await repo.authorize(actor.user_id, orgFromQuery());
    return json(z.object({ agents: z.array(AgentDefinitionSchema) }), {
      agents: ANALYSIS_AGENT_DEFINITIONS.map((agent) => ({ ...agent, instructions: '' })),
    });
  }
  if (path[0] === 'conversations' && path[1] && path.length === 3) {
    const id = IdSchema.parse(path[1]);
    if (path[2] === 'context') {
      if (method === 'GET') return json(ThreadContextSchema,
        await repo.getThreadContext(actor.user_id, orgFromQuery(), id));
      if (method === 'PUT') return json(ThreadContextSchema,
        await repo.updateThreadContext(actor.user_id, orgFromQuery(), id, ThreadContextSchema.parse(await body(request))));
    }
    if (path[2] === 'memory' && method === 'GET') {
      const org = orgFromQuery();
      const thread = await repo.getThreadContext(actor.user_id, org, id);
      return json(z.object({ items: z.array(MemoryEntrySchema) }), {
        items: await repo.listMemory(actor.user_id, org, {
          conversation_id: id, ...(thread.current_run_id ? { run_id: thread.current_run_id } : {}), limit: 24,
        }),
      });
    }
  }
  if (path[0] === 'runs' && path[1] && path.length === 3 && method === 'GET') {
    const id = IdSchema.parse(path[1]);
    const org = orgFromQuery();
    if (path[2] === 'runtime') return json(RunRuntimeSnapshotSchema,
      await repo.getRunRuntime(actor.user_id, org, id, eventCursor(request, url)));
    if (path[2] === 'events') {
      assertStreamAccept(request);
      const after = eventCursor(request, url);
      const load = async (cursor: number) => {
        const [detail, runtime] = await Promise.all([
          repo.getRun(actor.user_id, org, id), repo.getRunRuntime(actor.user_id, org, id, cursor),
        ]);
        return { run: detail.run, runtime };
      };
      const initial = await load(after);
      return durableEventStream({
        initial, load, after, signal: request.signal, eventName: 'runtime',
        events: (snapshot) => snapshot.runtime.events,
        terminal: ({ run }) => ['succeeded', 'failed', 'cancelled'].includes(run.status)
          ? { run_id: run.run_id, status: run.status } : null,
      });
    }
  }
  return null;
}

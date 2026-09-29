import { z } from 'zod';
import {
  AgentTurnAcceptedSchema,
  ConversationPageSchema,
  ConversationSchema,
  MessageSchema,
  MessagePageSchema,
  IdSchema,
  AgentTurnJobViewSchema,
  type AgentTurnJob,
  type AgentInvocation,
  type AgentExecutionEvent,
  AgentInvocationSchema,
  AgentExecutionEventSchema,
} from '@vda/contracts';
import { json } from '../middleware/response';
import { agentTurnSubmitter, streamAgentTurn } from '../streaming/agent-turn';
import type { AuthenticatedRouteContext } from './route-context';
import { durableEventStream } from '../../durable-event-stream';
import { assertStreamAccept, eventCursor } from './runtime-workspace';

function publicExecutionSnapshot(snapshot: { job: AgentTurnJob; invocations: AgentInvocation[]; events: AgentExecutionEvent[] } | null) {
  if (!snapshot) return null;
  const { job, ...rest } = snapshot;
  return { job: AgentTurnJobViewSchema.parse({
    job_id:job.job_id,conversation_id:job.conversation_id,user_message_id:job.user_message_id,
    assistant_message_id:job.assistant_message_id,status:job.status,run_id:job.run_id,
    error_code:job.error_code,created_at:job.created_at,updated_at:job.updated_at,
  }), ...rest };
}

export async function conversationRoutes(
  context: AuthenticatedRouteContext,
): Promise<Response | null> {
  const {
    method,
    route,
    repo,
    actor,
    orgFromQuery,
    request,
    path,
    agentTurnFromBody,
    pageFromQuery,
    url,
  } = context;
  if (path[0] === 'agent-turn-jobs' && path[1] && path.length <= 3) {
    const id = IdSchema.parse(path[1]);
    const org = orgFromQuery();
    if (path.length === 3 && path[2] === 'events' && method === 'GET') {
      assertStreamAccept(request);
      const after = eventCursor(request, url);
      const load = async (cursor: number) => publicExecutionSnapshot(await repo.getAgentTurnJob(actor.user_id, org, id, cursor))!;
      const initial = await load(after);
      return durableEventStream({ initial, load, after, signal: request.signal, eventName: 'execution',
        events: (snapshot) => snapshot.events,
        terminal: ({ job }) => ['completed', 'failed', 'cancelled'].includes(job.status)
          ? { job_id: job.job_id, status: job.status } : null,
      });
    }
    if (path.length === 2 && method === 'GET') {
      const after = z.coerce.number().int().min(0).parse(url.searchParams.get('after') ?? '0');
      return json(z.object({
        job: AgentTurnJobViewSchema,
        invocations: z.array(AgentInvocationSchema).max(100),
        events: z.array(AgentExecutionEventSchema).max(100),
      }).strict(), publicExecutionSnapshot(await repo.getAgentTurnJob(actor.user_id,org,id,after)));
    }
    if (path.length === 3 && path[2] === 'cancel' && method === 'POST')
      return json(AgentTurnJobViewSchema, publicExecutionSnapshot({job:await repo.cancelAgentTurnJob(actor.user_id,org,id),invocations:[],events:[]})!.job);
  }
  if (route === 'messages' && method === 'GET')
    return json(z.object({ messages: z.array(MessageSchema) }), {
      messages: await repo.messages(
        actor.user_id,
        orgFromQuery(),
        IdSchema.parse(url.searchParams.get('conversation_id')),
      ),
    });

  if (route === 'conversations') {
    if (method === 'GET')
      return json(
        ConversationPageSchema,
        await repo.listConversations(actor.user_id, orgFromQuery(), pageFromQuery()),
      );
    if (method === 'POST') {
      const input = await agentTurnFromBody();
      const key = z.string().min(1).max(200).parse(request.headers.get('idempotency-key'));
      return json(
        AgentTurnAcceptedSchema,
        await agentTurnSubmitter(repo).submit(actor.user_id, input, key, undefined, request.signal),
        202,
      );
    }
  }

  if (route === 'conversations/stream' && method === 'POST') {
    const input = await agentTurnFromBody();
    const key = z.string().min(1).max(200).parse(request.headers.get('idempotency-key'));
    return streamAgentTurn(request, repo, actor.user_id, input, key);
  }

  if (path[0] === 'conversations' && path[1]) {
    const id = IdSchema.parse(path[1]);
    if (path.length === 2 && method === 'GET')
      return json(
        ConversationSchema,
        await repo.getConversation(actor.user_id, orgFromQuery(), id),
      );
    if (path[2] === 'messages') {
      if (path.length === 4 && method === 'GET')
        return json(MessageSchema,
          await repo.getMessage(actor.user_id, orgFromQuery(), id, IdSchema.parse(path[3])));
      if (path.length === 4 && path[3] === 'stream' && method === 'POST') {
        const input = await agentTurnFromBody(id);
        const key = z.string().min(1).max(200).parse(request.headers.get('idempotency-key'));
        return streamAgentTurn(request, repo, actor.user_id, input, key, id);
      }
      if (path.length === 3 && method === 'GET')
        return json(
          MessagePageSchema,
          await repo.listMessages(actor.user_id, orgFromQuery(), id, pageFromQuery()),
        );
      if (method === 'POST') {
        const input = await agentTurnFromBody(id);
        const key = z.string().min(1).max(200).parse(request.headers.get('idempotency-key'));
        return json(
          AgentTurnAcceptedSchema,
          await agentTurnSubmitter(repo).submit(actor.user_id, input, key, id, request.signal),
          202,
        );
      }
    }
    if (path.length === 3 && path[2] === 'agent-turn-job' && method === 'GET')
      return json(z.object({
        job: AgentTurnJobViewSchema,
        invocations: z.array(AgentInvocationSchema).max(100),
        events: z.array(AgentExecutionEventSchema).max(100),
      }).strict().nullable(), publicExecutionSnapshot(await repo.getLatestAgentTurnJob(actor.user_id,orgFromQuery(),id)));
  }
  return null;
}

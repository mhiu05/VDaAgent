import { z } from 'zod';
import { AgentDefinitionSchema, RuntimeActivityRecordSchema, RuntimeActivityEventSchema, ThreadContextSchema, MemoryEntrySchema } from '@vda/contracts';
import { api, scoped } from '../../../lib/http/api-client';

export const RuntimeSnapshotSchema = z.object({
  records: z.array(RuntimeActivityRecordSchema),
  events: z.array(RuntimeActivityEventSchema),
  last_sequence: z.number().int().nonnegative(),
});
export type RuntimeSnapshot = z.infer<typeof RuntimeSnapshotSchema>;
export const listAgentDefinitions = (orgId: string) => api(scoped('/agent-definitions', orgId), z.object({ agents: z.array(AgentDefinitionSchema) }));
export const getRunRuntime = (orgId: string, runId: string) => api(scoped(`/runs/${runId}/runtime`, orgId), RuntimeSnapshotSchema);
export const getThreadContext = (orgId: string, conversationId: string) => api(scoped(`/conversations/${conversationId}/context`, orgId), ThreadContextSchema);
export const putThreadContext = (orgId: string, conversationId: string, context: z.infer<typeof ThreadContextSchema>) => api(scoped(`/conversations/${conversationId}/context`, orgId), ThreadContextSchema, { method: 'PUT', body: JSON.stringify(context) });
export const getThreadMemory = (orgId: string, conversationId: string) => api(scoped(`/conversations/${conversationId}/memory`, orgId), z.object({ items: z.array(MemoryEntrySchema) }));

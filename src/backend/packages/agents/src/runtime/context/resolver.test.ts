import { describe, expect, it, vi } from 'vitest';
import { ThreadContextSchema, type AgentTurnRequest } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { ContextResolver } from './resolver';
import { MemoryRetriever } from './memory';

const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const input: AgentTurnRequest = {
  org_id: id(1), client_turn_id: id(2), text: 'Compare reports',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null }, data_as_of: '2026-09-19',
};
function fixture() {
  const thread = ThreadContextSchema.parse({ active_report_id: id(3), current_run_id: id(4) });
  const repository = {
    getThreadContext: vi.fn(async () => thread),
    getContextReference: vi.fn(async (_user, _org, ref) => ({ ...ref, run_id: id(4), artifact_id: id(5) })),
    getMessage: vi.fn(async () => ({ parts: [{ type: 'report_ref', report_id: id(6), run_id: id(4) }] })),
  };
  return { repository, resolver: new ContextResolver(repository as unknown as Repository) };
}

describe('authorized context resolution', () => {
  it('message references override the thread and preserve multiple reports separately', async () => {
    const { resolver, repository } = fixture();
    const result = await resolver.resolve(id(9), { ...input, context_refs: [
      { type: 'report', id: id(7) }, { type: 'report', id: id(8) },
    ] }, id(10));
    expect(result.source).toBe('message');
    expect(result.references.map((ref) => ref.id)).toEqual([id(7), id(8)]);
    expect(result.active).toBeNull();
    expect(result.thread.active_report_id).toBe(id(3));
    expect(repository.getContextReference).toHaveBeenCalledTimes(2);
  });

  it('resolves the artifact being replied to before the thread default', async () => {
    const { resolver } = fixture();
    const result = await resolver.resolve(id(9), { ...input, reply_to_message_id: id(11) }, id(10));
    expect(result.source).toBe('reply');
    expect(result.active?.id).toBe(id(6));
  });

  it('uses persisted thread context when no message selection exists', async () => {
    const { resolver } = fixture();
    const result = await resolver.resolve(id(9), input, id(10));
    expect(result.source).toBe('thread');
    expect(result.active?.id).toBe(id(3));
  });

  it('keeps the active thread report when additional artifacts are referenced', async () => {
    const { resolver, repository } = fixture();
    repository.getThreadContext.mockResolvedValueOnce(ThreadContextSchema.parse({
      active_report_id: id(3), referenced_artifact_ids: [id(8)],
    }));
    const result = await resolver.resolve(id(9), input, id(10));
    expect(result.references).toHaveLength(2);
    expect(result.active?.id).toBe(id(3));
  });

  it('honors an explicit no-report context and asks before an ambiguous update', async () => {
    const { resolver, repository } = fixture();
    repository.getThreadContext.mockResolvedValueOnce(ThreadContextSchema.parse({}));
    const result = await resolver.resolve(id(9), { ...input, report_intent: 'update', workspace_context: {
      version: 1, mode: 'agent_chat', org_id: input.org_id, conversation_id: id(10),
      scope: input.scope, data_as_of: input.data_as_of,
      active_run_ref: null, active_report_ref: null, active_artifact_ref: null,
      dashboard_selection: null, evidence_ref: null, drilldown: null,
    } }, id(10));
    expect(result.active).toBeNull();
    expect(result.ambiguous_update).toBe(true);
  });

  it('fails closed on an unauthorized reference instead of guessing another report', async () => {
    const { resolver, repository } = fixture();
    repository.getContextReference.mockRejectedValueOnce(new Error('private details'));
    await expect(resolver.resolve(id(9), input, id(10))).rejects.toThrow('NO_AUTHORIZED_RESULT');
  });

  it('detects an ambiguous text-only update before starting report work', async () => {
    const { resolver, repository } = fixture();
    repository.getThreadContext.mockResolvedValueOnce(ThreadContextSchema.parse({}));
    const result = await resolver.resolve(id(9), { ...input, text: 'Update the report.' }, id(10));
    expect(result.ambiguous_update).toBe(true);
  });
});

describe('bounded three-layer memory retrieval', () => {
  it('prioritizes relevant current work and removes memory from a different run', async () => {
    const records = [
      { layer: 'working', run_id: id(4), summary: 'Revenue evidence', key: 'metrics' },
      { layer: 'working', run_id: id(99), summary: 'Old revenue', key: 'old' },
      { layer: 'episodic', summary: 'Revenue analysis outcome', key: 'outcome' },
      { layer: 'workspace', summary: 'Revenue metric definition', key: 'dictionary' },
    ].map((entry, index) => ({ ...entry, memory_id: id(index + 20), org_id: id(1),
      conversation_id: entry.layer === 'workspace' ? null : id(10), artifact_refs: [],
      created_at: '2026-09-19T00:00:00.000Z', updated_at: '2026-09-19T00:00:00.000Z',
    }));
    const repo = { listMemory: vi.fn(async () => records) } as unknown as Repository;
    const memory = await new MemoryRetriever(repo).retrieve({ userId: id(9), orgId: id(1), conversationId: id(10), runId: id(4), task: 'Revenue' });
    expect(memory.working).toHaveLength(1);
    expect(memory.episodic).toHaveLength(1);
    expect(memory.workspace).toHaveLength(1);
    expect(memory.working[0]?.run_id).toBe(id(4));
  });

  it('retains all available layers when recent working results fill the candidate window', async () => {
    const entries = [...Array.from({ length: 8 }, (_, i) => ({ layer: 'working', run_id: id(4), memory_id: id(i + 20) })),
      { layer: 'episodic', memory_id: id(40) }, { layer: 'workspace', memory_id: id(41) },
    ].map((entry) => ({ ...entry, summary: 'Inventory', key: 'result', conversation_id: id(10), updated_at: '2026-09-19' }));
    const repository = { listMemory: vi.fn(async () => entries) } as unknown as Repository;
    const memory = await new MemoryRetriever(repository).retrieve({ userId: id(9), orgId: id(1), conversationId: id(10), runId: id(4), task: 'Inventory' });
    expect(memory.working).toHaveLength(6);
    expect(memory.episodic).toHaveLength(1);
    expect(memory.workspace).toHaveLength(1);
  });
});

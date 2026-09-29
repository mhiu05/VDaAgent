import { describe, expect, it, vi } from 'vitest';
import { ThreadContextSchema, type AgentTurnRequest } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { ContextResolver } from '../../../src/backend/agents/runtime/context/resolver';
import { MemoryRetriever } from '../../../src/backend/agents/runtime/context/memory';

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const input: AgentTurnRequest = {
  org_id: id(1),
  client_turn_id: id(2),
  text: 'Compare reports',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
};
function fixture() {
  const repository = {
    getThreadContext: vi.fn(async () =>
      ThreadContextSchema.parse({
        active_report_id: id(3),
        current_run_id: id(4),
      }),
    ),
    getContextReference: vi.fn(async (_user, _org, reference) => ({
      ...reference,
      run_id: id(4),
      artifact_id: id(5),
    })),
    getMessage: vi.fn(async () => ({
      parts: [{ type: 'report_ref', report_id: id(6), run_id: id(4) }],
    })),
  };
  return { repository, resolver: new ContextResolver(repository as unknown as Repository) };
}

describe('authorized context selection', () => {
  it('keeps two explicit reports separate instead of inferring a primary', async () => {
    const { resolver, repository } = fixture();
    const resolved = await resolver.resolve(
      id(9),
      {
        ...input,
        context_refs: [
          { type: 'report', id: id(7) },
          { type: 'report', id: id(8) },
        ],
      },
      id(10),
    );
    expect(resolved.source).toBe('message');
    expect(resolved.references.map((ref) => ref.id)).toEqual([id(7), id(8)]);
    expect(resolved.active).toBeNull();
    expect(resolved.thread.active_report_id).toBe(id(3));
    expect(repository.getContextReference).toHaveBeenCalledTimes(2);
  });

  it('uses the replied-to report ahead of the thread default', async () => {
    const { resolver } = fixture();
    const resolved = await resolver.resolve(
      id(9),
      { ...input, reply_to_message_id: id(11) },
      id(10),
    );
    expect(resolved.source).toBe('reply');
    expect(resolved.active?.id).toBe(id(6));
  });

  it('uses persisted thread context and keeps additional artifact references', async () => {
    const { resolver, repository } = fixture();
    expect((await resolver.resolve(id(9), input, id(10))).active?.id).toBe(id(3));
    repository.getThreadContext.mockResolvedValueOnce(
      ThreadContextSchema.parse({
        active_report_id: id(3),
        referenced_artifact_ids: [id(8)],
      }),
    );
    const resolved = await resolver.resolve(id(9), input, id(10));
    expect(resolved.source).toBe('thread');
    expect(resolved.active?.id).toBe(id(3));
    expect(resolved.references).toHaveLength(2);
  });

  it('asks for clarification when an update has no selected report', async () => {
    const { resolver, repository } = fixture();
    repository.getThreadContext.mockResolvedValue(ThreadContextSchema.parse({}));
    const context = {
      version: 1 as const,
      mode: 'agent_chat' as const,
      org_id: input.org_id,
      conversation_id: id(10),
      scope: input.scope,
      data_as_of: input.data_as_of,
      active_run_ref: null,
      active_report_ref: null,
      active_artifact_ref: null,
      dashboard_selection: null,
      evidence_ref: null,
      drilldown: null,
    };
    const explicit = await resolver.resolve(
      id(9),
      { ...input, report_intent: 'update', workspace_context: context },
      id(10),
    );
    expect(explicit.active).toBeNull();
    expect(explicit.ambiguous_update).toBe(true);
    const implicit = await resolver.resolve(
      id(9),
      { ...input, text: 'Update the report.' },
      id(10),
    );
    expect(implicit.ambiguous_update).toBe(true);
  });

  it('fails closed when the selected reference is unauthorized', async () => {
    const { resolver, repository } = fixture();
    repository.getContextReference.mockRejectedValueOnce(new Error('private details'));
    await expect(resolver.resolve(id(9), input, id(10))).rejects.toThrow('NO_AUTHORIZED_RESULT');
  });
});

describe('three-layer memory selection', () => {
  it('removes another run from working memory while retaining relevant layers', async () => {
    const records = [
      { layer: 'working', run_id: id(4), summary: 'Revenue evidence', key: 'metrics' },
      { layer: 'working', run_id: id(99), summary: 'Old revenue', key: 'old' },
      { layer: 'episodic', summary: 'Revenue analysis outcome', key: 'outcome' },
      { layer: 'workspace', summary: 'Revenue metric definition', key: 'dictionary' },
    ].map((item, index) => ({
      ...item,
      memory_id: id(index + 20),
      org_id: id(1),
      conversation_id: item.layer === 'workspace' ? null : id(10),
      artifact_refs: [],
      created_at: '2026-09-19T00:00:00Z',
      updated_at: '2026-09-19T00:00:00Z',
    }));
    const repo = { listMemory: vi.fn(async () => records) } as unknown as Repository;
    const selected = await new MemoryRetriever(repo).retrieve({
      userId: id(9),
      orgId: id(1),
      conversationId: id(10),
      runId: id(4),
      task: 'Revenue',
    });
    expect(selected.working.map((entry) => entry.run_id)).toEqual([id(4)]);
    expect(selected.episodic).toHaveLength(1);
    expect(selected.workspace).toHaveLength(1);
  });

  it('reserves a place for episodic and workspace memory when working memory fills the window', async () => {
    const records = [
      ...Array.from({ length: 8 }, (_, index) => ({
        layer: 'working',
        run_id: id(4),
        memory_id: id(index + 20),
      })),
      { layer: 'episodic', memory_id: id(40) },
      { layer: 'workspace', memory_id: id(41) },
    ].map((item) => ({
      ...item,
      summary: 'Inventory',
      key: 'result',
      conversation_id: id(10),
      updated_at: '2026-09-19',
    }));
    const repo = { listMemory: vi.fn(async () => records) } as unknown as Repository;
    const selected = await new MemoryRetriever(repo).retrieve({
      userId: id(9),
      orgId: id(1),
      conversationId: id(10),
      runId: id(4),
      task: 'Inventory',
    });
    expect(selected.working).toHaveLength(6);
    expect(selected.episodic).toHaveLength(1);
    expect(selected.workspace).toHaveLength(1);
  });
});

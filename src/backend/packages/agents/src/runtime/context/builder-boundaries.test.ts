import { describe, expect, it, vi } from 'vitest';
import { ThreadContextSchema, type AgentTurnRequest } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { RuntimeContextBuilder } from './builder';

const id = (value: number) => `30000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const input: AgentTurnRequest = {
  org_id: id(1),
  client_turn_id: id(2),
  text: 'Explain the selected result',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
};
function fixture(dataAsOf = input.data_as_of) {
  const repository = {
    authorize: vi.fn(async () => 'owner'),
    catalog: vi.fn(async () => ({ projects: [{ project_external_id: 'P-ALPHA', zones: [] }] })),
    getConversation: vi.fn(async () => ({})),
    listMessages: vi.fn(async () => ({ messages: [] })),
    getThreadContext: vi.fn(async () => ThreadContextSchema.parse({})),
    getContextReference: vi.fn(async (_user, _org, ref) => ({
      ...ref,
      run_id: ref.id === id(8) ? id(6) : id(5),
      artifact_id: id(9),
    })),
    getRun: vi.fn(async (_user, _org, runId) => ({
      run: {
        run_id: runId,
        status: 'succeeded',
        request: {
          scope: input.scope,
          data_as_of: dataAsOf,
          conversation_id: id(99),
        },
      },
    })),
    decisionIntelligence: vi.fn(async () => ({ status: 'unavailable' })),
    decisionBrief: vi.fn(async () => {
      throw new Error('unavailable');
    }),
    publicArtifactById: vi.fn(async () => {
      throw new Error('unavailable');
    }),
    listMemory: vi.fn(async () => []),
  };
  return { repository, builder: new RuntimeContextBuilder(repository as unknown as Repository) };
}

describe('context selection boundaries', () => {
  it('does not allow a stale browser report to bypass scope freshness', async () => {
    const { builder } = fixture('2026-08-19');
    const context = await builder.build(
      id(3),
      {
        ...input,
        workspace_context: {
          version: 1,
          mode: 'agent_chat',
          org_id: input.org_id,
          conversation_id: id(4),
          scope: input.scope,
          data_as_of: input.data_as_of,
          active_run_ref: { run_id: id(5) },
          active_report_ref: { run_id: id(5), report_id: id(7) },
          active_artifact_ref: null,
          dashboard_selection: null,
          evidence_ref: null,
          drilldown: null,
        },
      },
      id(4),
    );
    expect(context.active_run).toBeNull();
    expect(context.allowed_run_ids).toEqual([]);
    expect(context.allowed_report_refs).toEqual([]);
    expect(context.provider_context.referenced_context).toEqual([]);
    expect(context.policy.requires_fresh_analysis).toBe(true);
  });

  it('allows explicitly attached reports from different periods without choosing a primary', async () => {
    const { builder } = fixture('2026-08-19');
    const context = await builder.build(
      id(3),
      {
        ...input,
        context_refs: [
          { type: 'report', id: id(7) },
          { type: 'report', id: id(8) },
        ],
      },
      id(4),
    );
    expect(context.active_run).toBeNull();
    expect(context.allowed_report_refs).toEqual([
      { run_id: id(5), report_id: id(7) },
      { run_id: id(6), report_id: id(8) },
    ]);
  });

  it('does not retrieve another thread working memory for an authorized artifact', async () => {
    const { builder, repository } = fixture();
    const context = await builder.build(
      id(3),
      { ...input, context_refs: [{ type: 'artifact', id: id(7) }] },
      id(4),
    );
    expect(context.active_run?.run_id).toBe(id(5));
    expect(repository.listMemory).toHaveBeenCalledWith(id(3), id(1), {
      conversation_id: id(4),
      limit: 24,
    });
  });

  it('inspects an explicit prior-period artifact instead of silently starting a fresh analysis', async () => {
    const { builder } = fixture('2026-08-19');
    const context = await builder.build(id(3), { ...input, context_refs: [
      { type: 'artifact', id: id(7) },
    ] }, id(4));
    expect(context.active_run?.run_id).toBe(id(5));
    expect(context.active_run?.data_as_of).toBe('2026-08-19');
    expect(context.policy.requires_fresh_analysis).toBe(false);
  });
});

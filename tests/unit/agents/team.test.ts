import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentDefinition, RuntimeActivityInput } from '@vda/contracts';
import { AgentMessageBus, TeamRuntime } from '../../../src/backend/agents/runtime/team/executor';
import {
  ToolRegistry,
  ToolResultSchema,
  type ToolExecutionContext,
  type ToolResult,
} from '../../../src/backend/agents/runtime/team/tools';

const result: ToolResult = {
  summary: 'Verified metric',
  evidence_refs: ['artifact:metrics.0'],
  artifact_refs: ['artifact'],
};
const definition = (id: string, allowed_tools: string[] = []): AgentDefinition => ({
  id,
  name: id,
  role: id,
  description: 'Specialist',
  instructions: 'Use evidence',
  allowed_tools,
  capabilities: [],
  avatar: { initials: id[0]!, color: '#fff' },
});
const toolContext = (agentKey = 'data'): ToolExecutionContext => ({
  agentKey,
  invocationId: 'root',
  signal: new AbortController().signal,
  authorize: vi.fn(async () => undefined),
  emit: vi.fn(async () => undefined),
});

describe('team invocation persistence', () => {
  it('emits nested requests and results with their own parents and verified references', async () => {
    const events: RuntimeActivityInput[] = [];
    const buildContext = vi.fn(async () => ({ instructions: 'authoritative', data: [] }));
    const tools = new ToolRegistry();
    tools.register({
      name: 'metrics.query',
      description: 'Verified metrics',
      inputSchema: z.object({}),
      outputSchema: ToolResultSchema,
      allowedAgents: ['data'],
      timeoutMs: 1_000,
      riskLevel: 'read',
      executionMode: 'internal',
      execute: async () => result,
      normalizeResult: (value) => value,
    });
    const runtime = new TeamRuntime({
      tools,
      buildContext,
      authorize: async () => undefined,
      emit: async (event) => {
        events.push(event);
      },
    });
    runtime.register({
      definition: definition('main'),
      inputSchema: z.object({}),
      allowedDelegates: ['insight'],
      execute: (_, context) => context.requestAgent('insight', 'Interpret', {}, 'insight'),
    });
    runtime.register({
      definition: definition('insight'),
      inputSchema: z.object({}),
      allowedDelegates: ['data'],
      execute: (_, context) => context.requestAgent('data', 'Get metrics', {}, 'insight:data'),
    });
    runtime.register({
      definition: definition('data', ['metrics.query']),
      inputSchema: z.object({}),
      allowedDelegates: [],
      execute: (_, context) => context.callTool('metrics.query', {}),
    });

    expect(await runtime.run('main', 'Explain changes', {}, 'root')).toEqual(result);
    expect(buildContext).toHaveBeenCalledTimes(3);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'invocation',
          step_key: 'insight:data',
          parent_step_key: 'insight',
          status: 'completed',
        }),
        expect.objectContaining({
          kind: 'message',
          agent_key: 'insight',
          target_agent_key: 'data',
          message_type: 'task_request',
        }),
        expect.objectContaining({
          kind: 'message',
          agent_key: 'data',
          target_agent_key: 'insight',
          message_type: 'task_result',
          evidence_refs: result.evidence_refs,
        }),
        expect.objectContaining({ kind: 'tool', tool_name: 'metrics.query', status: 'completed' }),
      ]),
    );
  });

  it('keeps parallel branch identities distinct', async () => {
    const events: RuntimeActivityInput[] = [];
    const runtime = new TeamRuntime({
      tools: new ToolRegistry(),
      buildContext: async () => ({}),
      authorize: async () => undefined,
      emit: async (event) => {
        events.push(event);
        await Promise.resolve();
      },
    });
    runtime.register({
      definition: definition('main'),
      inputSchema: z.object({}),
      allowedDelegates: ['one', 'two'],
      execute: async (_, context) => {
        await Promise.all([
          context.requestAgent('one', 'First', {}, 'one'),
          context.requestAgent('two', 'Second', {}, 'two'),
        ]);
        return result;
      },
    });
    for (const id of ['one', 'two'])
      runtime.register({
        definition: definition(id),
        inputSchema: z.object({}),
        allowedDelegates: [],
        execute: async () => result,
      });
    await runtime.run('main', 'Parallel work', {}, 'root');
    expect(
      events
        .filter((event) => event.kind === 'tool' && event.status === 'completed')
        .map((event) => event.step_key),
    ).toEqual(['one:delegate', 'two:delegate']);
  });

  it('rejects delegation cycles and call budget overflow before the child executes', async () => {
    const runtime = new TeamRuntime({
      tools: new ToolRegistry(),
      buildContext: async () => ({}),
      authorize: async () => undefined,
      emit: async () => undefined,
    });
    runtime.register({
      definition: definition('main'),
      inputSchema: z.object({}),
      allowedDelegates: ['child'],
      execute: (_, context) => context.requestAgent('child', 'Work', {}, 'child'),
    });
    runtime.register({
      definition: definition('child'),
      inputSchema: z.object({}),
      allowedDelegates: ['main'],
      execute: (_, context) => context.requestAgent('main', 'Loop', {}, 'loop'),
    });
    await expect(runtime.run('main', 'Work', {})).rejects.toThrow('AGENT_DELEGATION_CYCLE');

    const bounded = new TeamRuntime({
      tools: new ToolRegistry(),
      maxInvocations: 1,
      maxDepth: 0,
      buildContext: async () => ({}),
      authorize: async () => undefined,
      emit: async () => undefined,
    });
    const execute = vi.fn(async () => result);
    bounded.register({
      definition: definition('main'),
      inputSchema: z.object({}),
      allowedDelegates: ['child'],
      execute: (_, context) => context.requestAgent('child', 'Work', {}, 'child'),
    });
    bounded.register({
      definition: definition('child'),
      inputSchema: z.object({}),
      allowedDelegates: [],
      execute,
    });
    await expect(bounded.run('main', 'Work', {})).rejects.toThrow('AGENT_INVOCATION_LIMIT');
    expect(execute).not.toHaveBeenCalled();
    expect(AgentMessageBus).toBeDefined();
  });

  it('denies undeclared delegates before invoking another specialist', async () => {
    const runtime = new TeamRuntime({
      tools: new ToolRegistry(),
      buildContext: async () => ({}),
      authorize: async () => undefined,
      emit: async () => undefined,
    });
    runtime.register({
      definition: definition('data'),
      inputSchema: z.object({}),
      allowedDelegates: [],
      execute: (_, context) => context.requestAgent('main', 'Forbidden', {}, 'forbidden'),
    });
    await expect(runtime.run('data', 'Work', {})).rejects.toThrow('AGENT_DELEGATION_DENIED');
  });

  it('propagates the deadline to a cooperative tool and records cancellation', async () => {
    const events: RuntimeActivityInput[] = [];
    const tools = new ToolRegistry();
    let toolSignal: AbortSignal | undefined;
    tools.register({
      name: 'data.wait',
      description: 'Await data',
      inputSchema: z.object({}),
      outputSchema: ToolResultSchema,
      allowedAgents: ['data'],
      timeoutMs: 1_000,
      executionMode: 'internal',
      riskLevel: 'read',
      execute: async (_, context) => {
        toolSignal = context.signal;
        return new Promise(() => undefined);
      },
      normalizeResult: (value) => value,
    });
    const runtime = new TeamRuntime({
      tools,
      maxDurationMs: 20,
      buildContext: async () => ({}),
      authorize: async () => undefined,
      emit: async (event) => {
        events.push(event);
      },
    });
    runtime.register({
      definition: definition('main'),
      allowedDelegates: ['data'],
      inputSchema: z.object({}),
      execute: (_, context) => context.requestAgent('data', 'Get data', {}, 'child'),
    });
    runtime.register({
      definition: definition('data', ['data.wait']),
      allowedDelegates: [],
      inputSchema: z.object({}),
      execute: (_, context) => context.callTool('data.wait', {}),
    });
    await expect(runtime.run('main', 'Bounded work', {})).rejects.toThrow('TOOL_CANCELLED');
    expect(toolSignal?.aborted).toBe(true);
    expect(
      events.some((event) => event.kind === 'invocation' && event.status === 'cancelled'),
    ).toBe(true);
  });
});

describe('registered tool execution', () => {
  it('keeps the original database cause if recording a failure loses the lease', async () => {
    const cause = Object.assign(new Error('private SQL detail'), {
      code: '23514',
      constraint_name: 'artifact_refs_check',
    });
    const registry = new ToolRegistry();
    registry.register({
      name: 'data.fail',
      description: 'Read data',
      inputSchema: z.object({}),
      outputSchema: ToolResultSchema,
      allowedAgents: ['data'],
      timeoutMs: 1_000,
      riskLevel: 'read',
      executionMode: 'internal',
      execute: async () => {
        throw cause;
      },
      normalizeResult: (value) => value,
    });
    const context = {
      ...toolContext(),
      emit: vi.fn(async (event: Parameters<ToolExecutionContext['emit']>[0]) => {
        if (event.status === 'failed') throw new Error('LEASE_LOST');
      }),
    };
    await expect(registry.execute('data.fail', {}, context)).rejects.toMatchObject({
      code: 'TOOL_EXECUTION_FAILED',
      cause,
    });
    expect(context.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        errorCode: 'TOOL_EXECUTION_FAILED',
      }),
    );
    expect(JSON.stringify(context.emit.mock.calls)).not.toContain('private SQL');
  });

  it('enforces input, agent, output size and call count limits', async () => {
    const registry = new ToolRegistry({ maxCalls: 1, maxResultBytes: 500 });
    const execute = vi.fn(async () => ({ count: 120_000, raw: 'x'.repeat(10_000) }));
    registry.register({
      name: 'data.query',
      description: 'Query data',
      inputSchema: z.object({ id: z.number().int() }).strict(),
      outputSchema: z.object({ count: z.number(), raw: z.string() }),
      allowedAgents: ['data'],
      timeoutMs: 1_000,
      riskLevel: 'read',
      executionMode: 'internal',
      execute,
      normalizeResult: (value) => ({
        summary: `${value.count} rows`,
        structured_data: value,
        raw_result_ref: 'stored-result',
        artifact_refs: ['stored-result'],
        evidence_refs: [],
      }),
    });
    await expect(registry.execute('data.query', { id: 1 }, toolContext('report'))).rejects.toThrow(
      'TOOL_DENIED',
    );
    await expect(registry.execute('data.query', { id: 'bad' }, toolContext())).rejects.toThrow(
      'TOOL_INPUT_INVALID',
    );
    const response = await registry.execute('data.query', { id: 1 }, toolContext());
    expect(response).toMatchObject({
      summary: '120000 rows',
      raw_result_ref: 'stored-result',
      metadata: { compacted: true },
    });
    expect(response.structured_data).toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
    await expect(registry.execute('data.query', { id: 1 }, toolContext())).rejects.toThrow(
      'TOOL_CALL_LIMIT',
    );
  });

  it('rejects invalid outputs, timeouts, and cancellation', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'invalid',
      description: 'Invalid output',
      inputSchema: z.unknown(),
      outputSchema: z.number(),
      allowedAgents: ['data'],
      timeoutMs: 100,
      riskLevel: 'read',
      executionMode: 'internal',
      execute: async () => 'bad' as unknown as number,
      normalizeResult: () => result,
    });
    await expect(registry.execute('invalid', {}, toolContext())).rejects.toThrow(
      'TOOL_OUTPUT_INVALID',
    );
    registry.register({
      name: 'slow',
      description: 'Slow query',
      inputSchema: z.unknown(),
      outputSchema: z.unknown(),
      allowedAgents: ['data'],
      timeoutMs: 10,
      riskLevel: 'read',
      executionMode: 'internal',
      execute: async () => new Promise(() => undefined),
      normalizeResult: () => result,
    });
    await expect(registry.execute('slow', {}, toolContext())).rejects.toThrow('TOOL_TIMEOUT');
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      registry.execute('slow', {}, { ...toolContext(), signal: cancelled.signal }),
    ).rejects.toThrow('TOOL_CANCELLED');
  });
});

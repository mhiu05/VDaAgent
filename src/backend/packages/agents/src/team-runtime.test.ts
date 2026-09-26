import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentDefinition, RuntimeActivityInput } from '@vda/contracts';
import { AgentMessageBus, TeamRuntime } from './runtime/team/runtime';
import { ToolRegistry, ToolResultSchema, type ToolExecutionContext, type ToolResult } from './runtime/team/tools';
import { McpGateway } from './runtime/team/mcp-gateway';

const output: ToolResult = { summary: 'Verified metric', evidence_refs: ['artifact:metrics.0'], artifact_refs: ['artifact'] };
const agent = (id: string, tools: string[] = []): AgentDefinition => ({ id, name: id, role: id, description: 'Test specialist', instructions: 'Use verified evidence',
  allowed_tools: tools, capabilities: [], avatar: { initials: id[0]!, color: '#fff' } });
const toolContext = (agentKey = 'data'): ToolExecutionContext => ({ agentKey, invocationId: 'root', signal: new AbortController().signal,
  authorize: vi.fn(async () => undefined), emit: vi.fn(async () => undefined) });

describe('definition-driven team runtime', () => {
  it('persists nested agent-as-tool requests and results with correct hierarchy and context per invocation', async () => {
    const events: RuntimeActivityInput[] = [];
    const buildContext = vi.fn(async () => ({ instructions: 'authoritative', data: [] }));
    const tools = new ToolRegistry();
    tools.register({ name: 'metrics.query', description: 'Query verified metrics', inputSchema: z.object({}).strict(), outputSchema: ToolResultSchema,
      allowedAgents: ['data'], timeoutMs: 1000, riskLevel: 'read', executionMode: 'internal', execute: async () => output, normalizeResult: value => value });
    const runtime = new TeamRuntime({ tools, buildContext, authorize: async () => undefined, emit: async event => { events.push(event); } });
    runtime.register({ definition: agent('main'), inputSchema: z.object({}), allowedDelegates: ['insight'],
      execute: async (_, context) => context.requestAgent('insight', 'Interpret changes', {}, 'insight') });
    runtime.register({ definition: agent('insight'), inputSchema: z.object({}), allowedDelegates: ['data'],
      execute: async (_, context) => context.requestAgent('data', 'Get supporting metrics', {}, 'insight:data') });
    runtime.register({ definition: agent('data', ['metrics.query']), inputSchema: z.object({}), allowedDelegates: [],
      execute: async (_, context) => context.callTool('metrics.query', {}) });
    expect(await runtime.run('main', 'Explain changes', {}, 'root')).toEqual(output);
    expect(buildContext).toHaveBeenCalledTimes(3);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'invocation', step_key: 'insight:data', parent_step_key: 'insight', status: 'completed' }),
      expect.objectContaining({ kind: 'message', agent_key: 'insight', target_agent_key: 'data', message_type: 'task_request', correlation_id: 'insight:data' }),
      expect.objectContaining({ kind: 'message', agent_key: 'data', target_agent_key: 'insight', message_type: 'task_result', evidence_refs: output.evidence_refs }),
      expect.objectContaining({ kind: 'tool', tool_name: 'agent.data', status: 'completed' }),
      expect.objectContaining({ kind: 'tool', tool_name: 'metrics.query', status: 'completed' }),
    ]));
  });

  it('keeps concurrent branch invocation and tool identities separate', async () => {
    const events: RuntimeActivityInput[] = [];
    const runtime = new TeamRuntime({ tools: new ToolRegistry(), buildContext: async () => ({}), authorize: async () => undefined,
      emit: async event => { events.push(event); await Promise.resolve(); } });
    runtime.register({ definition: agent('main'), inputSchema: z.object({}), allowedDelegates: ['one', 'two'], execute: async (_, context) => {
      await Promise.all([context.requestAgent('one', 'First branch', {}, 'one'), context.requestAgent('two', 'Second branch', {}, 'two')]);
      return output;
    } });
    for (const id of ['one', 'two']) runtime.register({ definition: agent(id), inputSchema: z.object({}), allowedDelegates: [], execute: async () => output });
    await runtime.run('main', 'Parallel work', {}, 'root');
    expect(events.filter(event => event.kind === 'tool' && event.status === 'completed').map(event => event.step_key)).toEqual(['one:delegate', 'two:delegate']);
    const running = events.filter(event => event.step_key === 'root' && event.status === 'running');
    expect(running).toHaveLength(2); // preparation and one continuation after both branches
  });

  it('rejects delegation cycles and unauthorized specialists', async () => {
    const runtime = new TeamRuntime({ tools: new ToolRegistry(), buildContext: async () => ({}), authorize: async () => undefined, emit: async () => undefined });
    runtime.register({ definition: agent('main'), inputSchema: z.object({}), allowedDelegates: ['child'],
      execute: (_, context) => context.requestAgent('child', 'Work', {}, 'child') });
    runtime.register({ definition: agent('child'), inputSchema: z.object({}), allowedDelegates: ['main'],
      execute: (_, context) => context.requestAgent('main', 'Loop', {}, 'loop') });
    await expect(runtime.run('main', 'Work', {})).rejects.toThrow('AGENT_DELEGATION_CYCLE');
    const denied = new TeamRuntime({ tools: new ToolRegistry(), buildContext: async () => ({}), authorize: async () => undefined, emit: async () => undefined });
    denied.register({ definition: agent('data'), inputSchema: z.object({}), allowedDelegates: [],
      execute: (_, context) => context.requestAgent('main', 'Forbidden', {}, 'forbidden') });
    await expect(denied.run('data', 'Work', {})).rejects.toThrow('AGENT_DELEGATION_DENIED');
  });

  it('enforces depth and total invocation budgets before executing children', async () => {
    const runtime = new TeamRuntime({ tools: new ToolRegistry(), maxInvocations: 1, maxDepth: 0,
      buildContext: async () => ({}), authorize: async () => undefined, emit: async () => undefined });
    const execute = vi.fn(async () => output);
    runtime.register({ definition: agent('main'), inputSchema: z.object({}), allowedDelegates: ['data'],
      execute: (_, context) => context.requestAgent('data', 'Get data', {}, 'data') });
    runtime.register({ definition: agent('data'), inputSchema: z.object({}), allowedDelegates: [], execute });
    await expect(runtime.run('main', 'Work', {})).rejects.toThrow('AGENT_INVOCATION_LIMIT');
    expect(execute).not.toHaveBeenCalled();
    expect(AgentMessageBus).toBeDefined();
  });

  it('propagates the run deadline through child invocations and cooperative tools', async () => {
    const events: RuntimeActivityInput[] = [];
    const tools = new ToolRegistry();
    let toolSignal: AbortSignal | undefined;
    tools.register({ name: 'data.wait', description: 'Await data', inputSchema: z.object({}), outputSchema: ToolResultSchema,
      allowedAgents: ['data'], timeoutMs: 1000, executionMode: 'internal', riskLevel: 'read',
      execute: async (_, context) => { toolSignal = context.signal; return new Promise(() => undefined); }, normalizeResult: value => value });
    const runtime = new TeamRuntime({ tools, maxDurationMs: 20, buildContext: async () => ({}), authorize: async () => undefined,
      emit: async event => { events.push(event); } });
    runtime.register({ definition: agent('main'), allowedDelegates: ['data'], inputSchema: z.object({}),
      execute: (_, context) => context.requestAgent('data', 'Get data', {}, 'child') });
    runtime.register({ definition: agent('data', ['data.wait']), allowedDelegates: [], inputSchema: z.object({}),
      execute: (_, context) => context.callTool('data.wait', {}) });
    await expect(runtime.run('main', 'Bounded task', {})).rejects.toThrow('TOOL_CANCELLED');
    await Promise.resolve();
    expect(toolSignal?.aborted).toBe(true);
    expect(events.some(event => event.kind === 'invocation' && event.status === 'cancelled')).toBe(true);
  });
});

describe('tool runtime and centralized MCP gateway', () => {
  it('enforces schemas, agent permissions, result compaction and finite call budgets', async () => {
    const registry = new ToolRegistry({ maxCalls: 1, maxResultBytes: 500 });
    const execute = vi.fn(async () => ({ count: 120000, raw: 'x'.repeat(10000) }));
    registry.register({ name: 'data.query', description: 'Query data', inputSchema: z.object({ id: z.number().int() }).strict(),
      outputSchema: z.object({ count: z.number(), raw: z.string() }), allowedAgents: ['data'], timeoutMs: 1000, riskLevel: 'read', executionMode: 'internal', execute,
      normalizeResult: value => ({ summary: `${value.count} rows`, structured_data: value, raw_result_ref: 'stored-result', artifact_refs: ['stored-result'], evidence_refs: [] }) });
    await expect(registry.execute('data.query', { id: 1 }, toolContext('report'))).rejects.toThrow('TOOL_DENIED');
    await expect(registry.execute('data.query', { id: 'bad' }, toolContext())).rejects.toThrow('TOOL_INPUT_INVALID');
    const normalized = await registry.execute('data.query', { id: 1 }, toolContext());
    expect(normalized).toMatchObject({ summary: '120000 rows', raw_result_ref: 'stored-result', metadata: { compacted: true } });
    expect(normalized.structured_data).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(registry.execute('data.query', { id: 1 }, toolContext())).rejects.toThrow('TOOL_CALL_LIMIT');
  });

  it('enforces output validation, timeouts and cancellation', async () => {
    const registry = new ToolRegistry();
    registry.register({ name: 'invalid', description: 'Invalid output', inputSchema: z.unknown(), outputSchema: z.number(), allowedAgents: ['data'], timeoutMs: 100,
      riskLevel: 'read', executionMode: 'internal', execute: async () => 'bad' as unknown as number, normalizeResult: () => output });
    await expect(registry.execute('invalid', {}, toolContext())).rejects.toThrow('TOOL_OUTPUT_INVALID');
    registry.register({ name: 'slow', description: 'Slow query', inputSchema: z.unknown(), outputSchema: z.unknown(), allowedAgents: ['data'], timeoutMs: 10,
      riskLevel: 'read', executionMode: 'internal', execute: async () => new Promise(() => undefined), normalizeResult: () => output });
    await expect(registry.execute('slow', {}, toolContext())).rejects.toThrow('TOOL_TIMEOUT');
    const controller = new AbortController();
    controller.abort();
    await expect(registry.execute('slow', {}, { ...toolContext(), signal: controller.signal })).rejects.toThrow('TOOL_CANCELLED');
  });

  it('discovers MCP tools once, validates JSON schemas and shares a credential-referenced session', async () => {
    const registry = new ToolRegistry();
    const gateway = new McpGateway();
    const close = vi.fn(async () => undefined);
    const callTool = vi.fn(async () => ({ count: 12 }));
    const connect = vi.fn(async () => ({ callTool, close, listTools: async () => [{ name: 'count', description: 'Count data',
      inputSchema: { type: 'object', properties: { dataset: { type: 'string' } }, required: ['dataset'], additionalProperties: false },
      outputSchema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false } }] }));
    gateway.register({ id: 'warehouse', credentialReference: 'secrets/warehouse', allowedAgents: ['data'], allowedTools: ['count'], connect,
      normalizeResult: value => ({ summary: `Result for ${value}`, artifact_refs: [], evidence_refs: [] }) });
    await gateway.discover('warehouse', registry);
    await gateway.discover('warehouse', registry);
    await expect(registry.execute('mcp.warehouse.count', { dataset: 42 }, toolContext())).rejects.toThrow('TOOL_INPUT_INVALID');
    await registry.execute('mcp.warehouse.count', { dataset: 'inventory' }, toolContext());
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith('secrets/warehouse', expect.any(AbortSignal));
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(gateway.listServers()).toEqual([expect.objectContaining({ id: 'warehouse', status: 'healthy' })]);
    await gateway.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

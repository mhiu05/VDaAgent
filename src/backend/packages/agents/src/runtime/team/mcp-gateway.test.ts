import { describe, expect, it, vi } from 'vitest';
import { McpGateway, type McpSession } from './mcp-gateway';
import { ToolRegistry, type ToolExecutionContext } from './tools';

const capability = {
  name: 'count',
  description: 'Count rows',
  inputSchema: { type: 'object', additionalProperties: false },
  outputSchema: { type: 'number' },
};
const context = (): ToolExecutionContext => ({
  agentKey: 'data',
  invocationId: 'root',
  signal: new AbortController().signal,
  authorize: async () => undefined,
  emit: async () => undefined,
});

describe('MCP session lifecycle', () => {
  it('registers tools in each run registry while reusing the gateway session', async () => {
    const close = vi.fn(async () => undefined);
    const connect = vi.fn(async () => ({
      close,
      listTools: async () => [capability],
      callTool: async () => 12,
    }));
    const gateway = new McpGateway();
    gateway.register({
      id: 'data',
      allowedAgents: ['data'],
      allowedTools: ['count'],
      connect,
      normalizeResult: () => ({ summary: '12 rows', artifact_refs: [], evidence_refs: [] }),
    });
    const first = new ToolRegistry();
    const second = new ToolRegistry();
    await gateway.discover('data', first);
    await gateway.discover('data', second);
    expect(second.get('mcp.data.count')).toBeDefined();
    expect(await second.execute('mcp.data.count', {}, context())).toMatchObject({
      summary: '12 rows',
    });
    expect(connect).toHaveBeenCalledTimes(1);
    await gateway.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('invalidates a failed transport and reconnects for the next call', async () => {
    const close = vi.fn(async () => undefined);
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(new Error('private transport details'))
      .mockResolvedValue(12);
    const connect = vi.fn(async () => ({ close, listTools: async () => [capability], callTool }));
    const gateway = new McpGateway();
    gateway.register({
      id: 'data',
      allowedAgents: ['data'],
      allowedTools: ['count'],
      connect,
      normalizeResult: () => ({ summary: '12 rows', artifact_refs: [], evidence_refs: [] }),
    });
    const registry = new ToolRegistry();
    await gateway.discover('data', registry);
    await expect(registry.execute('mcp.data.count', {}, context())).rejects.toThrow(
      'MCP_EXECUTION_FAILED',
    );
    expect(close).toHaveBeenCalledTimes(1);
    await registry.execute('mcp.data.count', {}, context());
    expect(connect).toHaveBeenCalledTimes(2);
    await gateway.close();
  });

  it('closes a transport that finishes connecting after cancellation', async () => {
    let complete!: (session: McpSession) => void;
    const close = vi.fn(async () => undefined);
    const gateway = new McpGateway();
    gateway.register({
      id: 'data',
      allowedAgents: ['data'],
      allowedTools: ['count'],
      connect: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
      normalizeResult: () => ({ summary: '12 rows', artifact_refs: [], evidence_refs: [] }),
    });
    const controller = new AbortController();
    const discovery = gateway.discover('data', new ToolRegistry(), controller.signal);
    controller.abort();
    await expect(discovery).rejects.toThrow('MCP_DISCOVERY_FAILED');
    complete({ close, listTools: async () => [], callTool: async () => 12 });
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    await gateway.close();
  });
});

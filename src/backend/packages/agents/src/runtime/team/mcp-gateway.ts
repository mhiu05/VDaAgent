import { z } from 'zod';
import {
  abortable,
  ToolRegistry,
  ToolResultSchema,
  ToolRuntimeError,
  type ToolResult,
} from './tools';

export type McpToolCapability = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
};
export type McpSession = {
  listTools(signal: AbortSignal): Promise<McpToolCapability[]>;
  callTool(name: string, args: unknown, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
};
export type McpServerDefinition = {
  id: string;
  /** Only a secret-store key; credentials never enter definitions or agent context. */
  credentialReference?: string;
  allowedAgents: readonly string[];
  allowedTools: readonly string[];
  timeoutMs?: number;
  riskLevel?: 'read' | 'write';
  connect(credentialReference: string | undefined, signal: AbortSignal): Promise<McpSession>;
  /** Store raw responses under workspace authorization before returning compact references. */
  normalizeResult(tool: string, value: unknown): ToolResult;
};

async function closeSession(session: McpSession) {
  // Cleanup cannot hold the caller beyond its execution deadline indefinitely.
  await abortable(session.close(), AbortSignal.timeout(1000)).catch(() => undefined);
}

/** Owns one session per server, discovery, health and schema normalization. Agents see ordinary tools. */
export class McpGateway {
  private readonly servers = new Map<string, McpServerDefinition>();
  private readonly sessions = new Map<string, Promise<McpSession>>();
  private readonly health = new Map<
    string,
    { status: 'registered' | 'healthy' | 'unavailable'; checked_at: string }
  >();
  private readonly registered = new WeakMap<ToolRegistry, Set<string>>();
  register(server: McpServerDefinition) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(server.id) || this.servers.has(server.id))
      throw new ToolRuntimeError('MCP_SERVER_INVALID');
    this.servers.set(server.id, server);
    this.health.set(server.id, { status: 'registered', checked_at: new Date().toISOString() });
  }
  listServers() {
    return [...this.servers.keys()].map((id) => ({ id, ...this.health.get(id)! }));
  }
  private session(server: McpServerDefinition, signal: AbortSignal) {
    let session = this.sessions.get(server.id);
    if (!session) {
      const connection = server.connect(server.credentialReference, signal);
      // A transport may ignore cancellation while connecting. Release a late
      // session instead of leaking a connection after discovery has timed out.
      void connection
        .then(async (active) => {
          if (signal.aborted) await closeSession(active);
        })
        .catch(() => undefined);
      session = abortable(connection, signal).catch((error) => {
        this.sessions.delete(server.id);
        this.health.set(server.id, { status: 'unavailable', checked_at: new Date().toISOString() });
        throw error;
      });
      this.sessions.set(server.id, session);
    }
    return session;
  }
  private async invalidate(serverId: string) {
    const pending = this.sessions.get(serverId);
    this.sessions.delete(serverId);
    if (pending) await pending.then(closeSession).catch(() => undefined);
  }
  async discover(serverId: string, registry: ToolRegistry, signal = new AbortController().signal) {
    const server = this.servers.get(serverId);
    if (!server) throw new ToolRuntimeError('MCP_SERVER_NOT_FOUND');
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(server.timeoutMs ?? 30000)]);
    try {
      const session = await this.session(server, deadline);
      const capabilities = await abortable(session.listTools(deadline), deadline);
      const registered = this.registered.get(registry) ?? new Set<string>();
      this.registered.set(registry, registered);
      for (const capability of capabilities) {
        if (!server.allowedTools.includes(capability.name)) continue;
        const name = `mcp.${serverId}.${capability.name}`;
        if (registered.has(name)) continue;
        const inputSchema = z.fromJSONSchema(capability.inputSchema);
        const outputSchema = z.fromJSONSchema(capability.outputSchema);
        registry.register({
          name,
          description: capability.description.slice(0, 2000),
          inputSchema,
          outputSchema,
          allowedAgents: server.allowedAgents,
          timeoutMs: server.timeoutMs ?? 30000,
          riskLevel: server.riskLevel ?? 'read',
          executionMode: 'mcp',
          execute: async (input, context) => {
            try {
              const active = await this.session(server, context.signal);
              const result = await abortable(
                active.callTool(capability.name, input, context.signal),
                context.signal,
              );
              this.health.set(serverId, {
                status: 'healthy',
                checked_at: new Date().toISOString(),
              });
              return result;
            } catch {
              this.health.set(serverId, {
                status: 'unavailable',
                checked_at: new Date().toISOString(),
              });
              await this.invalidate(serverId);
              throw new ToolRuntimeError('MCP_EXECUTION_FAILED');
            }
          },
          normalizeResult: (output) =>
            ToolResultSchema.parse(server.normalizeResult(capability.name, output)),
        });
        registered.add(name);
      }
      this.health.set(serverId, { status: 'healthy', checked_at: new Date().toISOString() });
      return registry
        .listAvailableForAgent(server.allowedAgents[0] ?? '')
        .filter((tool) => tool.name.startsWith(`mcp.${serverId}.`));
    } catch {
      this.health.set(serverId, { status: 'unavailable', checked_at: new Date().toISOString() });
      await this.invalidate(serverId);
      throw new ToolRuntimeError('MCP_DISCOVERY_FAILED');
    }
  }
  async close() {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map(async (pending) => closeSession(await pending)));
  }
}

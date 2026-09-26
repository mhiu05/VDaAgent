import { z } from 'zod';
import type { AgentDefinition, RuntimeActivityInput } from '@vda/contracts';
import { abortable, ToolRegistry, ToolResultSchema, ToolRuntimeError, type Schema, type ToolResult } from './tools';

export type InvocationContext = {
  invocationId: string;
  agentKey: string;
  signal: AbortSignal;
  context: unknown;
  callTool(name: string, input: unknown): Promise<ToolResult>;
  requestAgent(agentKey: string, task: string, input: unknown, stepKey: string): Promise<ToolResult>;
};
export type RegisteredAgent<I = unknown> = {
  definition: AgentDefinition;
  allowedDelegates: readonly string[];
  maxCalls?: number;
  inputSchema: Schema<I>;
  execute(input: I, context: InvocationContext): Promise<ToolResult>;
};
export type TeamRuntimeOptions = {
  tools: ToolRegistry;
  emit: (activity: RuntimeActivityInput) => Promise<unknown>;
  authorize: () => Promise<void>;
  buildContext: (agent: AgentDefinition, task: string) => Promise<unknown>;
  signal?: AbortSignal;
  maxInvocations?: number;
  maxDepth?: number;
  maxDelegations?: number;
  maxDurationMs?: number;
};
type Frame = { key: string; agentKey: string; ancestors: string[]; depth: number };

/** Durable message transport. Requests/results share a correlation id and invocation parent. */
export class AgentMessageBus {
  constructor(private readonly emit: TeamRuntimeOptions['emit']) {}
  async send(input: { key: string; from: Frame; to: string; summary: string; result?: ToolResult }) {
    return this.emit({ kind: 'message', step_key: `${input.key}:${input.result ? 'response' : 'request'}`,
      parent_step_key: input.from.key, agent_key: input.result ? input.to : input.from.agentKey,
      target_agent_key: input.result ? input.from.agentKey : input.to,
      message_type: input.result ? 'task_result' : 'task_request', correlation_id: input.key,
      summary: input.summary.slice(0, 2000), artifact_refs: input.result?.artifact_refs.slice(0, 32) ?? [], evidence_refs: input.result?.evidence_refs.slice(0, 32) ?? [] });
  }
}

/** Definitions and permissions control execution; no persona count or report ownership is built in. */
export class TeamRuntime {
  private readonly agents = new Map<string, RegisteredAgent>();
  private readonly perAgent = new Map<string, number>();
  private readonly usedKeys = new Set<string>();
  private invocations = 0;
  private delegations = 0;
  private readonly signal: AbortSignal;
  private readonly bus: AgentMessageBus;
  constructor(private readonly options: TeamRuntimeOptions) {
    const deadline = AbortSignal.timeout(options.maxDurationMs ?? 600000);
    this.signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    this.bus = new AgentMessageBus(options.emit);
  }
  register<I>(agent: RegisteredAgent<I>) {
    if (this.agents.has(agent.definition.id)) throw new ToolRuntimeError('AGENT_ALREADY_REGISTERED');
    this.agents.set(agent.definition.id, agent as RegisteredAgent);
    return this;
  }
  definitions() { return [...this.agents.values()].map(agent => agent.definition); }
  async run(agentKey: string, task: string, input: unknown, stepKey = `team:${agentKey}`) {
    return this.invoke(agentKey, task, input, stepKey);
  }
  private async invoke(agentKey: string, task: string, input: unknown, stepKey: string, parent?: Frame, signal = this.signal): Promise<ToolResult> {
    const agent = this.agents.get(agentKey);
    if (!agent) throw new ToolRuntimeError('AGENT_NOT_FOUND');
    if (signal.aborted) throw new ToolRuntimeError('AGENT_CANCELLED');
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > (this.options.maxDepth ?? 6) || this.invocations >= (this.options.maxInvocations ?? 40)
      || (this.perAgent.get(agentKey) ?? 0) >= (agent.maxCalls ?? 6)) throw new ToolRuntimeError('AGENT_INVOCATION_LIMIT');
    if (parent?.ancestors.includes(agentKey) || parent?.agentKey === agentKey) throw new ToolRuntimeError('AGENT_DELEGATION_CYCLE');
    if (this.usedKeys.has(stepKey)) throw new ToolRuntimeError('AGENT_STEP_REUSED');
    const parsed = agent.inputSchema.parse(input);
    this.usedKeys.add(stepKey);
    this.invocations++;
    this.perAgent.set(agentKey, (this.perAgent.get(agentKey) ?? 0) + 1);
    const frame: Frame = { key: stepKey, agentKey, depth, ancestors: parent ? [...parent.ancestors, parent.agentKey] : [] };
    const base = { kind: 'invocation' as const, step_key: stepKey, parent_step_key: parent?.key, agent_key: agentKey };
    await this.options.authorize();
    await this.options.emit({ ...base, status: 'running', summary: `Preparing ${agent.definition.name}` });
    const started = Date.now();
    let pendingChildren = 0;
    const toolCalls = new Map<string, number>();
    try {
      const context = await abortable(this.options.buildContext(agent.definition, task), signal);
      const metrics = z.object({ build_ms: z.number().int().nonnegative(), estimated_tokens: z.number().int().nonnegative() }).safeParse(context);
      if (metrics.success) Object.assign(base, { context_build_ms: metrics.data.build_ms, context_tokens: metrics.data.estimated_tokens });
      const result = ToolResultSchema.parse(await abortable(agent.execute(parsed, {
        invocationId: stepKey, agentKey, signal, context,
        callTool: async (name, toolInput) => {
          if (!agent.definition.allowed_tools.includes(name)) throw new ToolRuntimeError('TOOL_DENIED');
          const sequence = (toolCalls.get(name) ?? 0) + 1;
          toolCalls.set(name, sequence);
          return this.options.tools.execute(name, toolInput, {
            agentKey, invocationId: stepKey, callKey: `${stepKey}:tool:${name}:${sequence}`, signal, authorize: this.options.authorize,
            emit: event => this.options.emit({ kind: 'tool', step_key: event.toolCallId, parent_step_key: stepKey,
              agent_key: agentKey, tool_name: event.toolName, status: event.status, summary: event.summary,
              duration_ms: event.durationMs, error_code: event.errorCode,
              artifact_refs: event.result?.artifact_refs.slice(0, 32) ?? [], evidence_refs: event.result?.evidence_refs.slice(0, 32) ?? [] }).then(() => undefined),
          });
        },
        requestAgent: async (target, request, childInput, childStepKey) => {
          if (!agent.allowedDelegates.includes(target)) throw new ToolRuntimeError('AGENT_DELEGATION_DENIED');
          const delegationId = ++this.delegations;
          if (delegationId > (this.options.maxDelegations ?? 30)) throw new ToolRuntimeError('AGENT_DELEGATION_LIMIT');
          pendingChildren++;
          await this.bus.send({ key: childStepKey, from: frame, to: target, summary: request });
          await this.options.emit({ ...base, status: 'waiting', summary: `Waiting for ${this.agents.get(target)?.definition.name ?? target}` });
          // Agent calls enter the same validated, authorized tool loop as other tools.
          const name = `agent.${target}.${delegationId}`;
          this.options.tools.register({ name, description: request.slice(0, 2000), inputSchema: z.unknown(), outputSchema: ToolResultSchema,
            allowedAgents: [agentKey], timeoutMs: 300000, riskLevel: 'read', executionMode: 'agent',
            execute: (_, execution) => this.invoke(target, request, childInput, childStepKey, frame, execution.signal), normalizeResult: value => value });
          try {
            const child = await this.options.tools.execute(name, childInput, { agentKey, invocationId: stepKey, callKey: `${childStepKey}:delegate`, signal,
              authorize: this.options.authorize, emit: event => this.options.emit({ kind: 'tool', step_key: event.toolCallId,
                parent_step_key: stepKey, agent_key: agentKey, tool_name: `agent.${target}`, status: event.status,
                summary: event.summary, duration_ms: event.durationMs, error_code: event.errorCode,
                artifact_refs: event.result?.artifact_refs.slice(0, 32) ?? [], evidence_refs: event.result?.evidence_refs.slice(0, 32) ?? [] }).then(() => undefined) });
            await this.bus.send({ key: childStepKey, from: frame, to: target, summary: child.summary, result: child });
            return child;
          } finally {
            pendingChildren--;
            if (!signal.aborted && pendingChildren === 0) await this.options.emit({ ...base, status: 'running', summary: `${agent.definition.name} continuing` });
          }
        },
      }), signal));
      if (signal.aborted) throw new ToolRuntimeError('AGENT_CANCELLED');
      await this.options.authorize();
      await this.options.emit({ ...base, status: 'completed', summary: result.summary, duration_ms: Date.now() - started,
        artifact_refs: result.artifact_refs.slice(0, 32), evidence_refs: result.evidence_refs.slice(0, 32) });
      return result;
    } catch (error) {
      try {
        await this.options.emit({ ...base, status: signal.aborted ? 'cancelled' : 'failed', summary: `${agent.definition.name} stopped`,
          duration_ms: Date.now() - started, error_code: error instanceof ToolRuntimeError ? error.code : 'AGENT_EXECUTION_FAILED' });
      } catch { /* Cancellation or reclaimed lease wins over obsolete runtime writes. */ }
      throw error;
    }
  }
}

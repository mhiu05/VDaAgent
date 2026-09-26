import { z } from 'zod';

export const ToolResultSchema = z.object({
  summary: z.string().max(2000),
  structured_data: z.unknown().optional(),
  evidence_refs: z.array(z.string().max(500)).max(100).default([]),
  artifact_refs: z.array(z.string().max(200)).max(100).default([]),
  raw_result_ref: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
}).strict();
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type Schema<T = unknown> = { parse(value: unknown): T };
export type ToolExecutionContext = {
  agentKey: string;
  invocationId: string;
  callKey?: string;
  signal: AbortSignal;
  /** Rechecks the durable run fence and workspace authorization. */
  authorize: () => Promise<void>;
  emit: (event: ToolExecutionEvent) => Promise<void>;
};
export type ToolExecutionEvent = {
  toolCallId: string; toolName: string; status: 'running' | 'completed' | 'failed' | 'cancelled';
  summary: string; durationMs?: number; errorCode?: string; result?: ToolResult;
};
export type ToolDefinition<I = unknown, O = unknown> = {
  name: string;
  description: string;
  inputSchema: Schema<I>;
  outputSchema: Schema<O>;
  allowedAgents: readonly string[];
  timeoutMs: number;
  riskLevel: 'read' | 'write';
  executionMode: 'internal' | 'mcp' | 'agent';
  execute: (input: I, context: ToolExecutionContext) => Promise<O>;
  normalizeResult: (output: O) => ToolResult;
};
export class ToolRuntimeError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** Race even non-cooperative adapters, while passing cancellation to cooperative ones. */
export async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => undefined);
    throw new ToolRuntimeError('TOOL_CANCELLED');
  }
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      onAbort = () => reject(new ToolRuntimeError('TOOL_CANCELLED'));
      signal.addEventListener('abort', onAbort, { once: true });
    })]);
  } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
}

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();
  private calls = 0;
  constructor(private readonly options: { maxCalls?: number; maxResultBytes?: number } = {}) {}

  register<I, O>(definition: ToolDefinition<I, O>) {
    if (!/^[a-z][a-z0-9_.-]{0,119}$/.test(definition.name) || this.definitions.has(definition.name))
      throw new ToolRuntimeError('TOOL_REGISTRATION_INVALID');
    if (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs < 1 || definition.timeoutMs > 300000)
      throw new ToolRuntimeError('TOOL_TIMEOUT_INVALID');
    this.definitions.set(definition.name, definition as ToolDefinition);
    return this;
  }

  get(name: string) { return this.definitions.get(name); }
  listAvailableForAgent(agentKey: string) {
    return [...this.definitions.values()].filter(tool => tool.allowedAgents.includes(agentKey));
  }
  validateInput(name: string, input: unknown) {
    const definition = this.get(name);
    if (!definition) throw new ToolRuntimeError('TOOL_NOT_FOUND');
    try { return definition.inputSchema.parse(input); }
    catch { throw new ToolRuntimeError('TOOL_INPUT_INVALID'); }
  }
  authorize(name: string, agentKey: string) {
    const definition = this.get(name);
    if (!definition || !definition.allowedAgents.includes(agentKey)) throw new ToolRuntimeError('TOOL_DENIED');
    return definition;
  }

  normalizeResult(definition: ToolDefinition, output: unknown): ToolResult {
    let result: ToolResult;
    try { result = ToolResultSchema.parse(definition.normalizeResult(output)); }
    catch { throw new ToolRuntimeError('TOOL_OUTPUT_INVALID'); }
    const maximum = this.options.maxResultBytes ?? 16000;
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= maximum) return result;
    // Large data must already live behind an authorized immutable reference.
    if (!result.raw_result_ref && !result.artifact_refs.length) throw new ToolRuntimeError('TOOL_RESULT_REFERENCE_REQUIRED');
    result = { ...result, structured_data: undefined, metadata: { ...result.metadata, compacted: true } };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maximum) throw new ToolRuntimeError('TOOL_RESULT_LIMIT');
    return result;
  }

  async execute(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const definition = this.authorize(name, context.agentKey);
    const parsed = this.validateInput(name, input);
    if (this.calls >= (this.options.maxCalls ?? 80)) throw new ToolRuntimeError('TOOL_CALL_LIMIT');
    if (context.signal.aborted) throw new ToolRuntimeError('TOOL_CANCELLED');
    const call = ++this.calls;
    await context.authorize();
    const toolCallId = context.callKey ?? `${context.invocationId}:tool:${call}`;
    const started = Date.now();
    const timeout = AbortSignal.timeout(definition.timeoutMs);
    const signal = AbortSignal.any([context.signal, timeout]);
    await context.emit({ toolCallId, toolName: name, status: 'running', summary: definition.description });
    try {
      const raw = await abortable(definition.execute(parsed, { ...context, signal }), signal);
      let output: unknown;
      try { output = definition.outputSchema.parse(raw); }
      catch { throw new ToolRuntimeError('TOOL_OUTPUT_INVALID'); }
      const result = this.normalizeResult(definition, output);
      await context.authorize();
      await context.emit({ toolCallId, toolName: name, status: 'completed', summary: result.summary, durationMs: Date.now() - started, result });
      return result;
    } catch (error) {
      const code = context.signal.aborted ? 'TOOL_CANCELLED' : timeout.aborted ? 'TOOL_TIMEOUT'
        : error instanceof Error && /^[A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'TOOL_EXECUTION_FAILED';
      await context.emit({ toolCallId, toolName: name, status: code === 'TOOL_CANCELLED' ? 'cancelled' : 'failed',
        summary: code === 'TOOL_CANCELLED' ? 'Tool cancelled' : 'Tool could not complete', durationMs: Date.now() - started, errorCode: code });
      throw new ToolRuntimeError(code);
    }
  }
}

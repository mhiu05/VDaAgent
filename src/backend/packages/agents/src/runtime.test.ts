import { describe, expect, it, vi } from 'vitest';
import type {
  AgentPlanV1,
  AgentTurnRequest,
  CapabilityResultV1,
  MessageStatus,
} from '@vda/contracts';
import { RepositoryError, type AgentTurn, type Repository } from '@vda/db';
import { AgentRuntime } from './runtime/runtime';
import type { CapabilityRegistry } from './runtime/capabilities/registry';
import { AgentRuntimeProviderError } from './runtime/providers/errors';
import { type AgentRuntimeProvider } from './runtime/providers/contracts';
import { type RuntimeContextBuilder } from './runtime/context/builder';
import { runtimeLimits } from './runtime/limits';

const ORG = '10000000-0000-4000-8000-000000000001';
const CONVERSATION = '20000000-0000-4000-8000-000000000001';
const USER_MESSAGE = '30000000-0000-4000-8000-000000000001';
const ASSISTANT_MESSAGE = '40000000-0000-4000-8000-000000000001';
const RUN = '50000000-0000-4000-8000-000000000001';

function input(): AgentTurnRequest {
  return {
    org_id: ORG,
    client_turn_id: '60000000-0000-4000-8000-000000000001',
    text: 'Inspect the authorized result.',
    scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
    data_as_of: '2026-09-19',
  };
}

function turn(
  idempotentReplay = false,
  runId: string | null = null,
  status: MessageStatus = 'in_progress',
) {
  return {
    conversation: { conversation_id: CONVERSATION },
    user_message: { message_id: USER_MESSAGE },
    assistant_message: { message_id: ASSISTANT_MESSAGE, run_id: runId, status },
    idempotent_replay: idempotentReplay,
  } as unknown as AgentTurn;
}

function context() {
  return {
    version: 'authorized-agent-context-v1' as const,
    org_id: ORG,
    actor: { user_id: '70000000-0000-4000-8000-000000000001', role: 'owner' as const },
    conversation: { conversation_id: CONVERSATION },
    scope: input().scope,
    data_as_of: input().data_as_of,
    mode: 'agent_chat' as const,
    active_run: null,
    active_report: null,
    active_artifact: null,
    active_chart: null,
    active_priority_entity: null,
    drilldown: null,
    evidence: null,
    available_workspace_actions: [],
    resolution_issues: [],
    request: {
      text: input().text,
      use_case: 'slow_moving_inventory' as const,
      agent_target: null,
      signal_action: null,
      requested_signal_ref: null,
    },
    allowed_scopes: [input().scope],
    allowed_run_ids: [],
    allowed_conversation_run_ids: [],
    allowed_report_refs: [],
    allowed_signal_refs: [],
    allowed_evidence_refs: [],
    allowed_dashboard: {
      kpi_ids: [],
      chart_ids: [],
      priority_entity_ids: [],
      insight_ids: [],
      action_candidate_ids: [],
      drilldown_ids: [],
    },
    active_decision: null,
    policy: { requires_fresh_analysis: false },
    provider_context: { version: 'authorized-agent-context-v1' },
  };
}

function metadata(provider: 'gemini' | 'openai' | 'xai' = 'gemini') {
  return {
    provider,
    model: 'fixture',
    request_id: null,
    latency_ms: 1,
    http_status: 200,
    zero_data_retention: null,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    fallback_from: null,
  };
}

const queuedPlan: AgentPlanV1 = {
  version: 'agent-plan-v1',
  intent: 'create_analysis',
  steps: [
    {
      step_id: 'create_analysis',
      capability_id: 'create_analysis',
      input: { focus: 'current_inventory' },
    },
  ],
  answer_mode: 'queued',
  unsupported_reason: null,
};

const readPlan: AgentPlanV1 = {
  version: 'agent-plan-v1',
  intent: 'get_analysis_result',
  steps: [
    {
      step_id: 'get-result',
      capability_id: 'get_analysis_result',
      input: { run_id: RUN },
    },
  ],
  answer_mode: 'grounded',
  unsupported_reason: null,
};

function queuedResult(): CapabilityResultV1 {
  return {
    version: 'capability-result-v1',
    capability_id: 'create_analysis',
    status: 'pending',
    observations: [
      {
        observation_id: 'create-analysis-1',
        kind: 'status',
        availability: 'pending',
        canonical_text: 'Analysis queued.',
        display_value: null,
        support_level: null,
        grounding_refs: [{ type: 'run', ref: { run_id: RUN, status: 'queued' } }],
      },
    ],
    available_workspace_actions: [],
    queued_run_ref: { run_id: RUN, status: 'queued' },
    error_code: null,
  };
}

function availableReadResult(): CapabilityResultV1 {
  return {
    version: 'capability-result-v1',
    capability_id: 'get_analysis_result',
    status: 'available',
    observations: [
      {
        observation_id: 'result-available',
        kind: 'status',
        availability: 'available',
        canonical_text: 'The authorized analysis result is available.',
        display_value: null,
        support_level: null,
        grounding_refs: [{ type: 'run', ref: { run_id: RUN, status: 'succeeded' } }],
      },
    ],
    available_workspace_actions: [],
    queued_run_ref: null,
    error_code: null,
  };
}

describe('AgentRuntime', () => {
  it('admits an eligible durable turn without starting a second message pair', async () => {
    const enqueueAgentTurn = vi.fn().mockResolvedValue({
      ...turn(),
      job: {
        job_id: '80000000-0000-4000-8000-000000000001',
      },
    });
    const startTurn = vi.fn();
    const plan = vi.fn();
    const runtime = new AgentRuntime({ enqueueAgentTurn, startTurn } as unknown as Repository, {
      durable_admission: true,
      provider: {
        provider: 'gemini',
        model: 'fixture',
        plan,
        compose: vi.fn(),
      } as AgentRuntimeProvider,
    });
    const result = await runtime.submit(
      '70000000-0000-4000-8000-000000000001',
      { ...input(), text: 'Analyze inventory' },
      'durable-runtime',
    );
    expect(result).toMatchObject({
      user_message_id: USER_MESSAGE,
      assistant_message_id: ASSISTANT_MESSAGE,
      agent_turn_job_id: '80000000-0000-4000-8000-000000000001',
    });
    expect(enqueueAgentTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).not.toHaveBeenCalled();
    expect(plan).not.toHaveBeenCalled();
  });

  it('preserves the accepted job identity when durable admission is disabled on replay', async () => {
    const startTurn = vi.fn().mockResolvedValue(turn(true));
    const getAgentTurnJobForMessage = vi.fn().mockResolvedValue({
      job_id: '80000000-0000-4000-8000-000000000001',
    });
    const runtime = new AgentRuntime(
      { startTurn, getAgentTurnJobForMessage } as unknown as Repository,
      {
        durable_admission: false,
        provider: {
          provider: 'gemini',
          model: 'fixture',
          plan: vi.fn(),
          compose: vi.fn(),
        } as AgentRuntimeProvider,
      },
    );
    const result = await runtime.submit(
      '70000000-0000-4000-8000-000000000001',
      { ...input(), text: 'Analyze inventory' },
      'existing-durable',
    );
    expect(result.agent_turn_job_id).toBe('80000000-0000-4000-8000-000000000001');
    expect(startTurn).toHaveBeenCalledOnce();
  });

  it('replays a non-durable turn when durable admission was enabled later', async () => {
    const enqueueAgentTurn = vi
      .fn()
      .mockRejectedValue(new RepositoryError('TURN_NOT_DURABLE', 409));
    const startTurn = vi.fn().mockResolvedValue(turn(true));
    const runtime = new AgentRuntime(
      {
        enqueueAgentTurn,
        startTurn,
        getAgentTurnJobForMessage: vi.fn().mockResolvedValue(null),
      } as unknown as Repository,
      {
        durable_admission: true,
        provider: {
          provider: 'gemini',
          model: 'fixture',
          plan: vi.fn(),
          compose: vi.fn(),
        } as AgentRuntimeProvider,
      },
    );
    const result = await runtime.submit(
      '70000000-0000-4000-8000-000000000001',
      { ...input(), text: 'Analyze inventory' },
      'existing-http',
    );
    expect(result).toMatchObject({
      user_message_id: USER_MESSAGE,
      assistant_message_id: ASSISTANT_MESSAGE,
    });
    expect(result.agent_turn_job_id).toBeUndefined();
    expect(enqueueAgentTurn).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledOnce();
  });

  it('plans once, creates one queued run, and replays without a second mutation', async () => {
    const startTurn = vi
      .fn()
      .mockResolvedValueOnce(turn())
      .mockResolvedValueOnce(turn(true, RUN, 'in_progress'));
    const repository = {
      startTurn,
      finalizeTurn: vi.fn(),
      getAgentTurnJobForMessage: vi.fn().mockResolvedValue(null),
    } as unknown as Repository;
    const plan = vi.fn(async (_input, _signal, validate) => {
      await validate?.(queuedPlan);
      return { value: queuedPlan, metadata: metadata() };
    });
    const compose = vi.fn();
    const provider = {
      provider: 'gemini',
      model: 'fixture',
      plan,
      compose,
    } as AgentRuntimeProvider;
    const execute = vi.fn(async () => queuedResult());
    const descriptor = {
      id: 'create_analysis',
      kind: 'mutation',
      creates_run: true,
      activity_label: 'starting_analysis',
      pass_to_answer_composer: false,
      max_calls_per_turn: 1,
    };
    const registry = {
      available: () => ['create_analysis'],
      descriptor: () => descriptor,
      preflight: () => ({ descriptor }),
      execute,
    } as unknown as CapabilityRegistry;
    const build = vi.fn(async () => context());
    const runtime = new AgentRuntime(repository, {
      provider,
      context_builder: { build } as unknown as RuntimeContextBuilder,
      registry,
    });

    const first = await runtime.submit(
      '70000000-0000-4000-8000-000000000001',
      input(),
      'queued-runtime',
    );
    const replay = await runtime.submit(
      '70000000-0000-4000-8000-000000000001',
      input(),
      'queued-runtime',
    );

    expect(first).toMatchObject({ run_id: RUN, assistant_status: 'in_progress' });
    expect(replay).toEqual(first);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(compose).not.toHaveBeenCalled();
    expect(repository.finalizeTurn).not.toHaveBeenCalled();
  });

  it('returns an in-progress idempotent placeholder without re-planning or re-executing', async () => {
    const startTurn = vi.fn().mockResolvedValueOnce(turn(true));
    const finalizeTurn = vi.fn();
    const repository = {
      startTurn,
      finalizeTurn,
      getAgentTurnJobForMessage: vi.fn().mockResolvedValue(null),
    } as unknown as Repository;
    const plan = vi.fn(async (_input, _signal, validate) => {
      await validate?.(queuedPlan);
      return { value: queuedPlan, metadata: metadata() };
    });
    const execute = vi.fn(async () => queuedResult());
    const descriptor = {
      id: 'create_analysis',
      kind: 'mutation',
      creates_run: true,
      activity_label: 'starting_analysis',
      pass_to_answer_composer: false,
      max_calls_per_turn: 1,
    };
    const registry = {
      available: () => ['create_analysis'],
      descriptor: () => descriptor,
      preflight: () => ({ descriptor }),
      execute,
    } as unknown as CapabilityRegistry;
    const build = vi.fn(async () => context());
    const runtime = new AgentRuntime(repository, {
      provider: {
        provider: 'gemini',
        model: 'fixture',
        plan,
        compose: vi.fn(),
      } as AgentRuntimeProvider,
      context_builder: { build } as unknown as RuntimeContextBuilder,
      registry,
    });

    const result = await runtime.submit(
      '70000000-0000-4000-8000-000000000001',
      input(),
      'resumable-runtime',
    );

    expect(result).toMatchObject({ run_id: null, assistant_status: 'in_progress' });
    expect(build).not.toHaveBeenCalled();
    expect(plan).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(finalizeTurn).not.toHaveBeenCalled();
  });

  it('preflights the full plan before executing its first step', async () => {
    const startTurn = vi.fn(async () => turn());
    const finalizeTurn = vi.fn(async () => undefined);
    const repository = { startTurn, finalizeTurn } as unknown as Repository;
    const invalid = {
      ...queuedPlan,
      steps: Array.from({ length: 2 }, (_, index) => ({
        step_id: 'step-' + index,
        capability_id: 'create_analysis' as const,
        input: { focus: 'current_inventory' as const },
      })),
    } as unknown as AgentPlanV1;
    const provider = {
      provider: 'gemini' as const,
      model: 'fixture',
      plan: async (_input, _signal, validate) => {
        await validate?.(invalid);
        return { value: invalid, metadata: metadata() };
      },
      compose: vi.fn(),
    } as AgentRuntimeProvider;
    const execute = vi.fn();
    const registry = {
      available: () => ['create_analysis'],
      descriptor: () => ({
        id: 'create_analysis',
        kind: 'mutation',
        creates_run: true,
        activity_label: 'starting_analysis',
        pass_to_answer_composer: false,
        max_calls_per_turn: 1,
      }),
      preflight: vi.fn(),
      execute,
    } as unknown as CapabilityRegistry;
    const runtime = new AgentRuntime(repository, {
      provider,
      context_builder: { build: async () => context() } as unknown as RuntimeContextBuilder,
      registry,
    });

    const result = await runtime.submit(
      '70000000-0000-4000-8000-000000000001',
      input(),
      'invalid-runtime-plan',
    );

    expect(result.assistant_status).toBe('failed');
    expect(execute).not.toHaveBeenCalled();
    expect(finalizeTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('uses the configured turn deadline for the planner signal', async () => {
    const startTurn = vi.fn(async () => turn());
    const finalizeTurn = vi.fn(async () => undefined);
    const plan = vi.fn(
      async (_input: unknown, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true)),
            { once: true },
          );
        }),
    );
    const execute = vi.fn();
    const descriptor = {
      id: 'get_analysis_result',
      kind: 'read',
      creates_run: false,
      activity_label: 'inspecting_context',
      max_calls_per_turn: 1,
    };
    const runtime = new AgentRuntime({ startTurn, finalizeTurn } as unknown as Repository, {
      provider: {
        provider: 'gemini',
        model: 'fixture',
        plan,
        compose: vi.fn(),
      } as unknown as AgentRuntimeProvider,
      context_builder: { build: async () => context() } as unknown as RuntimeContextBuilder,
      registry: {
        available: () => ['get_analysis_result'],
        descriptor: () => descriptor,
        preflight: () => ({ descriptor }),
        execute,
      } as unknown as CapabilityRegistry,
      limits: { ...runtimeLimits(), turn_timeout_ms: 10 },
    });

    const result = await runtime.submit(
      '70000000-0000-4000-8000-000000000001',
      input(),
      'configured-deadline-runtime',
    );

    expect(result.assistant_status).toBe('failed');
    expect(plan).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(finalizeTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        status: 'failed',
        parts: expect.arrayContaining([expect.objectContaining({ code: 'PROVIDER_TIMEOUT' })]),
      }),
    );
  });

  it('uses the deterministic grounded renderer when composer selections are invalid without re-executing reads', async () => {
    const startTurn = vi.fn(async () => turn());
    const finalizeTurn = vi.fn(async () => undefined);
    const repository = {
      startTurn,
      finalizeTurn,
      authorize: vi.fn(async () => 'owner'),
      getRun: vi.fn(async () => ({ run: { run_id: RUN, status: 'succeeded' } })),
    } as unknown as Repository;
    const plan = vi.fn(async (_input, _signal, validate) => {
      await validate?.(readPlan);
      return { value: readPlan, metadata: metadata() };
    });
    const compose = vi.fn(async (_input, _signal, validate) => {
      const forgedSelection = {
        version: 'grounded-response-selection-v1',
        status: 'complete',
        title_key: 'analysis_answer',
        blocks: [{ kind: 'summary', observation_ids: ['not-supplied'] }],
        workspace_action_ids: [],
        queued_run_ref: null,
        error_code: null,
      };
      await validate?.(forgedSelection as never);
      return { value: forgedSelection as never, metadata: metadata() };
    });
    const descriptor = {
      id: 'get_analysis_result',
      kind: 'read',
      creates_run: false,
      activity_label: 'inspecting_context',
      pass_to_answer_composer: true,
      max_calls_per_turn: 1,
    };
    const execute = vi.fn(async () => availableReadResult());
    const registry = {
      available: () => ['get_analysis_result'],
      descriptor: () => descriptor,
      preflight: () => ({ descriptor }),
      execute,
    } as unknown as CapabilityRegistry;
    const runtimeContext = {
      ...context(),
      active_run: {
        run_id: RUN,
        status: 'succeeded' as const,
        scope: input().scope,
        data_as_of: input().data_as_of,
      },
      allowed_run_ids: [RUN],
    };
    const runtime = new AgentRuntime(repository, {
      provider: {
        provider: 'gemini',
        model: 'fixture',
        plan,
        compose,
      } as AgentRuntimeProvider,
      context_builder: {
        build: async () => runtimeContext,
      } as unknown as RuntimeContextBuilder,
      registry,
    });

    const result = await runtime.submit(
      '70000000-0000-4000-8000-000000000001',
      input(),
      'composer-fallback-runtime',
    );

    expect(result.assistant_status).toBe('completed');
    expect(plan).toHaveBeenCalledTimes(1);
    expect(compose).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    const composerInput = compose.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(composerInput).not.toHaveProperty('context');
    expect(composerInput.observations).toEqual([
      {
        observation_id: 'result-available',
        kind: 'status',
        availability: 'available',
        support_level: null,
      },
    ]);
    expect(finalizeTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        status: 'completed',
        content: expect.stringContaining('The authorized analysis result is available.'),
      }),
    );
  });
});

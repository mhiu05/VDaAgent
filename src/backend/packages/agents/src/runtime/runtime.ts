import {
  AgentPlanV1Schema,
  AgentTurnAcceptedSchema,
  AgentTurnRequestSchema,
  isApprovedDurableAnalysisTurn,
  resolveReportIntent,
  type AgentPlanV1,
  type AgentRuntimeErrorCode,
  type AgentTurnAccepted,
  type AgentTurnRequest,
  type AvailableWorkspaceActionV1,
  type CanonicalAgentObservationV1,
  type CapabilityInvocation,
  type MessageStatus,
  type ResolvedAgentTurnRequest,
} from '@vda/contracts';
import { getConfig } from '@vda/config';
import { RepositoryError, type AgentJobLease, type AgentTurn, type Repository, type TurnContext } from '@vda/db';
import { AgentActivityEmitter, type AgentActivitySink } from './activity';
import {
  deterministicGroundedAnswer,
  validateAndRenderGroundedResponse,
  type RenderedGroundedResponse,
} from './composition/answer-composer';
import {
  CapabilityRegistry,
  CapabilityRegistryError,
  createCapabilityExecutionBudget,
} from './capabilities/registry';
import {
  PlannerValidationError,
  validateAgentPlan,
  type ValidatedAgentPlan,
} from './planning/planner';
import type { AgentRuntimeProvider } from './providers/contracts';
import { AgentRuntimeProviderError } from './providers/errors';
import { createAgentRuntimeProvider } from './providers/factory';
import { RuntimeContextBuilder, assertWorkspaceConversationCoherence } from './context/builder';
import { RuntimeContextError, type AuthorizedAgentContextV1 } from './context/types';
import { runtimeLimits, type AgentRuntimeLimits } from './limits';
import { isCausalQuestion } from '../chat/operations';
import { enqueueEligibleDurableTurn } from './admission';
import { isArtifactSpecialist } from '../analysis-v1/team-workflow';

const safeCopy: Record<AgentRuntimeErrorCode, string> = {
  UNSUPPORTED_REQUEST: 'This request is not supported by the authorized analysis workspace.',
  UNSUPPORTED_CAUSAL_REQUEST:
    'The authorized inventory snapshots cannot establish a causal explanation for this request.',
  UNSUPPORTED_SCOPE: 'The selected scope is not supported by this analysis workspace.',
  MISSING_CONTEXT: 'Choose a valid project and data date before continuing.',
  NO_AUTHORIZED_RESULT: 'No authorized result is available in this conversation context.',
  STALE_CONTEXT: 'The selected workspace context is stale. Refresh the result before continuing.',
  PROVIDER_UNAVAILABLE:
    'The assistant service is temporarily unavailable. Try the same request again.',
  PROVIDER_TIMEOUT: 'The assistant request timed out. Try the same request again.',
  PROVIDER_OUTPUT_INVALID:
    'The assistant could not produce a safe response. Try the same request again.',
  RUNTIME_LIMIT_EXCEEDED: 'This request exceeds the bounded assistant runtime limit.',
  CAPABILITY_DENIED: 'The requested authorized workspace action is not available.',
  CAPABILITY_UNAVAILABLE: 'An authorized result is not available for this request.',
  CAPABILITY_OUTPUT_INVALID: 'An authorized result could not be validated for this request.',
  GROUNDING_INVALID: 'Only a limited authorized reference response is available for this request.',
  TURN_CANCELLED: 'The assistant request was cancelled.',
};

type RuntimeOptions = {
  provider?: AgentRuntimeProvider;
  context_builder?: RuntimeContextBuilder;
  registry?: CapabilityRegistry;
  activity_sink?: AgentActivitySink;
  limits?: AgentRuntimeLimits;
  durable_admission?: boolean;
};

type DeterministicOutcome =
  { kind: 'plan'; plan: AgentPlanV1 } | { kind: 'terminal'; code: AgentRuntimeErrorCode };

function isCheckpointTarget(
  target: NonNullable<AuthorizedAgentContextV1['request']['agent_target']>,
): target is 'data' | 'analyst' | 'comparison' | 'insight' | 'chart' | 'report' | 'reviewer' {
  return ['data', 'analyst', 'comparison', 'insight', 'chart', 'report', 'reviewer'].includes(target);
}

function turnContext(turn: AgentTurn, input: ResolvedAgentTurnRequest): TurnContext {
  return {
    org_id: input.org_id,
    conversation_id: turn.conversation.conversation_id,
    user_message_id: turn.user_message.message_id,
    assistant_message_id: turn.assistant_message.message_id,
    client_turn_id: input.client_turn_id,
  };
}

function accepted(
  context: TurnContext,
  runId: string | null,
  assistantStatus: MessageStatus,
  jobId?: string,
): AgentTurnAccepted {
  return AgentTurnAcceptedSchema.parse({
    conversation_id: context.conversation_id,
    user_message_id: context.user_message_id,
    assistant_message_id: context.assistant_message_id,
    run_id: runId,
    assistant_status: assistantStatus,
    ...(jobId ? { agent_turn_job_id: jobId } : {}),
  });
}

function oneStepPlan(
  intent: string,
  step: CapabilityInvocation,
  answerMode: AgentPlanV1['answer_mode'],
) {
  return AgentPlanV1Schema.parse({
    version: 'agent-plan-v1',
    intent,
    steps: [step],
    answer_mode: answerMode,
    unsupported_reason: null,
  });
}

function deterministicPolicy(context: AuthorizedAgentContextV1): DeterministicOutcome | null {
  const requestedSignal = context.request.requested_signal_ref;
  if (context.request.signal_action === 'inspect' && requestedSignal)
    return {
      kind: 'plan',
      plan: oneStepPlan(
        'inspect_signal',
        {
          step_id: 'inspect-signal',
          capability_id: 'inspect_signal',
          input: requestedSignal,
        },
        'grounded',
      ),
    };
  if (context.request.signal_action === 'analyze_segment' && requestedSignal)
    return {
      kind: 'plan',
      plan: oneStepPlan(
        'create_analysis',
        {
          step_id: 'create-analysis',
          capability_id: 'create_analysis',
          input: { focus: 'current_inventory' },
        },
        'queued',
      ),
    };
  if (isCausalQuestion(context.request.text))
    return { kind: 'terminal', code: 'UNSUPPORTED_CAUSAL_REQUEST' };
  const reportMutation = context.request.report_intent === 'new' || context.request.report_intent === 'update' ||
    ((context.request.agent_target === 'report' || /\breport\b|báo cáo/iu.test(context.request.text)) &&
    /\b(create|generate|new|separate|another|edit|update|fix|revise)\b|tạo|sửa|cập nhật/iu.test(context.request.text));
  if (reportMutation) {
    if (context.actor.role === 'viewer') return { kind: 'terminal', code: 'CAPABILITY_DENIED' };
    return { kind: 'plan', plan: oneStepPlan('create_analysis', {
      step_id: 'create-analysis', capability_id: 'create_analysis', input: { focus: 'current_inventory' },
    }, 'queued') };
  }
  const specialistRequest = isArtifactSpecialist(context.request.agent_target) &&
    (context.allowed_run_ids.length === 0 || /\b(analy[sz]e|calculate|compute|generate|create|fresh|rerun|refresh|find)\b|phân tích|tính toán/iu.test(context.request.text));
  if (specialistRequest) {
    if (context.actor.role === 'viewer') return { kind: 'terminal', code: 'CAPABILITY_DENIED' };
    return { kind: 'plan', plan: oneStepPlan('create_analysis', {
      step_id: 'create-analysis', capability_id: 'create_analysis', input: { focus: 'current_inventory' },
    }, 'queued') };
  }
  if (context.policy.requires_fresh_analysis) {
    if (context.actor.role === 'viewer')
      return { kind: 'terminal', code: 'CAPABILITY_UNAVAILABLE' };
    return {
      kind: 'plan',
      plan: oneStepPlan(
        'create_analysis',
        {
          step_id: 'create-analysis',
          capability_id: 'create_analysis',
          input: { focus: 'current_inventory' },
        },
        'queued',
      ),
    };
  }
  if (context.request.agent_target && isCheckpointTarget(context.request.agent_target))
    return {
      kind: 'plan',
      plan: oneStepPlan(
        'inspect_agent_checkpoint',
        {
          step_id: 'inspect-agent-checkpoint',
          capability_id: 'inspect_agent_checkpoint',
          input: { agent_target: context.request.agent_target },
        },
        'grounded',
      ),
    };
  // Selecting Main uses the same planner as an untargeted request.
  if (context.request.agent_target && context.request.agent_target !== 'coordinator')
    return { kind: 'terminal', code: 'UNSUPPORTED_REQUEST' };
  return null;
}

function errorCode(error: unknown): AgentRuntimeErrorCode {
  if (error instanceof RuntimeContextError) return error.code;
  if (error instanceof PlannerValidationError) return error.code;
  if (error instanceof CapabilityRegistryError) return error.code;
  if (error instanceof AgentRuntimeProviderError) return error.code;
  return 'PROVIDER_UNAVAILABLE';
}

function retryable(error: unknown) {
  return error instanceof AgentRuntimeProviderError ? error.retryable : false;
}

function isTerminalTurnRace(error: unknown) {
  return (
    error instanceof RepositoryError &&
    (error.code === 'TURN_TERMINAL' || error.code === 'TURN_HAS_RUN')
  );
}

function isAuthorizationLoss(error: unknown) {
  return error instanceof RepositoryError && error.status === 403;
}

function ensureWithinDeadline(deadline: AbortSignal, requestSignal?: AbortSignal) {
  if (requestSignal?.aborted) throw new AgentRuntimeProviderError('TURN_CANCELLED', false);
  if (deadline.aborted) throw new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true);
}

function configuredLimits(options: RuntimeOptions) {
  if (options.limits) return options.limits;
  // Tests commonly provide an in-memory provider without application config.
  // Production creation reaches this branch only after the BFF has validated
  // configuration; no environment value is silently ignored there.
  if (options.provider) return runtimeLimits();
  const config = getConfig();
  return runtimeLimits(config);
}

export class AgentRuntime {
  private readonly provider: AgentRuntimeProvider;
  private readonly contextBuilder: RuntimeContextBuilder;
  private readonly registry: CapabilityRegistry;
  private readonly activitySink: AgentActivitySink | undefined;
  private readonly limits: AgentRuntimeLimits;
  private readonly durableAdmission: boolean;

  constructor(
    private readonly repository: Repository,
    options: RuntimeOptions = {},
  ) {
    this.provider = options.provider ?? createAgentRuntimeProvider();
    this.contextBuilder = options.context_builder ?? new RuntimeContextBuilder(repository);
    this.registry = options.registry ?? new CapabilityRegistry(repository);
    this.activitySink = options.activity_sink;
    this.limits = configuredLimits(options);
    this.durableAdmission = options.durable_admission ?? false;
  }

  private isBoundedProviderProjection(value: unknown) {
    return (
      Buffer.byteLength(JSON.stringify(value), 'utf8') <= this.limits.max_provider_projection_bytes
    );
  }

  private async finalize(
    userId: string,
    context: TurnContext,
    status: Extract<MessageStatus, 'completed' | 'failed' | 'cancelled'>,
    code: AgentRuntimeErrorCode,
    retry = false,
    includeError = status !== 'completed',
    lease?: AgentJobLease,
    contentOverride?: string,
  ) {
    const content = contentOverride ?? safeCopy[code];
    const result = {
      status,
      content,
      parts: [
        { type: 'text' as const, text: content },
        ...(includeError ? [{ type: 'error' as const, code, retryable: retry }] : []),
      ],
    };
    if (lease) await this.repository.finalizeAgentTurnExecution(lease, result);
    else await this.repository.finalizeTurn(userId, context, result);
    return accepted(context, null, status);
  }

  private async finalizeRendered(
    userId: string,
    context: TurnContext,
    authorized: AuthorizedAgentContextV1,
    rendered: RenderedGroundedResponse,
    lease?: AgentJobLease,
  ) {
    // Rendering performs reference checks; this final membership check closes
    // the race between composition and persistence.
    await this.repository.authorize(authorized.actor.user_id, authorized.org_id);
    const result = {
      status: 'completed' as const,
      content: rendered.content,
      parts: rendered.parts,
      sender_agent: authorized.request.agent_target,
    };
    if (lease) await this.repository.finalizeAgentTurnExecution(lease, result);
    else await this.repository.finalizeTurn(userId, context, result);
    return accepted(context, rendered.primary_run_id, 'completed');
  }

  private async replayAccepted(
    userId: string,
    input: ResolvedAgentTurnRequest,
    idempotencyKey: string,
    conversationId?: string,
    existingTurn?: AgentTurn,
  ) {
    const replay =
      existingTurn ??
      (await this.repository.startTurn(userId, input, idempotencyKey, conversationId));
    const context = turnContext(replay, input);
    const job = await this.repository.getAgentTurnJobForMessage(
      userId,
      input.org_id,
      replay.user_message.message_id,
    );
    return accepted(
      context,
      replay.assistant_message.run_id,
      replay.assistant_message.status,
      job?.job_id,
    );
  }

  private async plan(
    authorized: AuthorizedAgentContextV1,
    signal: AbortSignal,
    counters: { planner_calls: number },
  ): Promise<ValidatedAgentPlan> {
    if (counters.planner_calls >= this.limits.max_logical_planner_calls)
      throw new PlannerValidationError('RUNTIME_LIMIT_EXCEEDED');
    counters.planner_calls++;
    const providerInput = {
      question: authorized.request.text,
      context: authorized.provider_context,
      capabilities: this.registry.available(authorized),
    };
    if (!this.isBoundedProviderProjection(providerInput))
      throw new PlannerValidationError('RUNTIME_LIMIT_EXCEEDED');
    let validated: ValidatedAgentPlan | null = null;
    await this.provider.plan(providerInput, signal, (value) => {
      validated = validateAgentPlan(value, this.registry, authorized);
    });
    if (!validated) throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', true);
    return validated;
  }

  private async compose(
    authorized: AuthorizedAgentContextV1,
    observations: CanonicalAgentObservationV1[],
    actions: AvailableWorkspaceActionV1[],
    signal: AbortSignal,
    counters: { composer_calls: number },
  ) {
    if (counters.composer_calls >= this.limits.max_logical_composer_calls)
      throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', false);
    counters.composer_calls++;
    const providerInput = {
      observations: observations.map(({ observation_id, kind, availability, support_level }) => ({
        observation_id,
        kind,
        availability,
        support_level,
      })),
      available_workspace_actions: actions.map(({ action_id }) => ({ action_id })),
    };
    if (!this.isBoundedProviderProjection(providerInput))
      return deterministicGroundedAnswer({
        observations,
        available_workspace_actions: actions,
        context: authorized,
        repository: this.repository,
      });
    let rendered: RenderedGroundedResponse | null = null;
    try {
      await this.provider.compose(providerInput, signal, async (selection) => {
        rendered = await validateAndRenderGroundedResponse(selection, {
          observations,
          available_workspace_actions: actions,
          context: authorized,
          repository: this.repository,
        });
      });
      if (!rendered) throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', true);
      return rendered;
    } catch (error) {
      if (error instanceof AgentRuntimeProviderError && error.code === 'TURN_CANCELLED')
        throw error;
      return deterministicGroundedAnswer({
        observations,
        available_workspace_actions: actions,
        context: authorized,
        repository: this.repository,
      });
    }
  }

  async submit(
    userId: string,
    inputValue: AgentTurnRequest,
    idempotencyKey: string,
    conversationId?: string,
    requestSignal?: AbortSignal,
  ): Promise<AgentTurnAccepted> {
    const input = AgentTurnRequestSchema.parse(inputValue);
    // This is pure request/route coherence, so reject it before a user or
    // assistant message is persisted. Repository startTurn still owns the
    // transactional idempotency and write authorization checks below.
    assertWorkspaceConversationCoherence(input, conversationId);
    const durable = await enqueueEligibleDurableTurn(
      this.repository,
      this.durableAdmission,
      userId,
      input,
      idempotencyKey,
      conversationId,
    );
    if (durable)
      return accepted(
        turnContext(durable, input),
        durable.assistant_message.run_id,
        durable.assistant_message.status,
        durable.job.job_id,
      );
    const turn = await this.repository.startTurn(userId, input, idempotencyKey, conversationId);
    const context = turnContext(turn, input);
    // `startTurn` serializes idempotency-key lookup, but it deliberately
    // releases that database transaction before any provider or capability
    // work. Re-running a placeholder here would let concurrent retries spend
    // a second planner/read budget (and could race a mutation). The original
    // caller owns execution; every replay observes the persisted turn state.
    // A committed run is already attached transactionally and is therefore
    // returned here without a duplicate create request.
    if (turn.idempotent_replay)
      return this.replayAccepted(userId, input, idempotencyKey, conversationId, turn);

    return this.executeTurn(userId, input, idempotencyKey, context, requestSignal);
  }

  /** Reuses the validated capability loop under the worker's durable job fence. */
  async resumeDurableTurn(lease: AgentJobLease, requestSignal?: AbortSignal): Promise<AgentTurnAccepted> {
    const execution = await this.repository.getAgentTurnExecution(lease);
    if (isApprovedDurableAnalysisTurn(execution.input)) {
      const run = await this.repository.startAgentAnalysis(lease);
      return accepted(execution.context, run.run_id, 'in_progress', lease.job.job_id);
    }
    return this.executeTurn(lease.job.created_by, AgentTurnRequestSchema.parse(execution.input), execution.idempotency_key,
      execution.context, requestSignal, lease);
  }

  private async executeTurn(
    userId: string,
    input: ResolvedAgentTurnRequest,
    idempotencyKey: string,
    context: TurnContext,
    requestSignal?: AbortSignal,
    lease?: AgentJobLease,
  ): Promise<AgentTurnAccepted> {

    const deadline = AbortSignal.timeout(this.limits.turn_timeout_ms);
    const signal = requestSignal ? AbortSignal.any([requestSignal, deadline]) : deadline;
    const activity = new AgentActivityEmitter(this.activitySink);
    const stageCounters = { planner_calls: 0, composer_calls: 0 };
    try {
      ensureWithinDeadline(deadline, requestSignal);
      activity.emit('context_started', 'understanding_context');
      const authorized = await this.contextBuilder.build(userId, input, context.conversation_id);
      ensureWithinDeadline(deadline, requestSignal);
      activity.emit('context_ready', 'inspecting_context');

      const policy = deterministicPolicy(authorized);
      const plan =
        policy?.kind === 'plan'
          ? validateAgentPlan(policy.plan, this.registry, authorized)
          : policy?.kind === 'terminal'
            ? null
            : await this.plan(authorized, signal, stageCounters);
      if (policy?.kind === 'terminal') {
        activity.emit('error', 'safe_error', { error_code: policy.code });
        return this.finalize(userId, context, 'completed', policy.code, false, false, lease);
      }
      if (!plan) throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', true);
      if (plan.answer_mode === 'unavailable') {
        const code = plan.unsupported_reason ?? 'CAPABILITY_UNAVAILABLE';
        activity.emit('error', 'safe_error', { error_code: code });
        return this.finalize(userId, context, 'completed', code, false, false, lease);
      }

      const budget = createCapabilityExecutionBudget();
      const observations: CanonicalAgentObservationV1[] = [];
      const actions: AvailableWorkspaceActionV1[] = [];
      for (const [index, step] of plan.steps.entries()) {
        ensureWithinDeadline(deadline, requestSignal);
        const descriptor = this.registry.descriptor(step.capability_id);
        if (!descriptor) throw new CapabilityRegistryError('CAPABILITY_DENIED');
        activity.emit('tool_started', descriptor.activity_label, { capability: descriptor.id });
        if (lease && descriptor.creates_run) {
          // The planner and registry have authorized this mutation; the job
          // repository atomically creates/links the run and releases the job.
          const run = await this.repository.startAgentAnalysis(lease, { planned: true });
          return accepted(context, run.run_id, 'in_progress', lease.job.job_id);
        }
        const jobState = lease ? await this.repository.getAgentTurnJob(userId, input.org_id, lease.job.job_id) : null;
        const parent = jobState?.invocations.find(invocation => invocation.parent_invocation_id === null);
        const invocation = lease && parent ? await this.repository.createAgentInvocation(lease, parent.invocation_id,
          `capability:${index}:${descriptor.id}`, authorized.request.agent_target ?? 'coordinator') : null;
        if (lease && invocation && invocation.status !== 'completed')
          await this.repository.setAgentInvocationStatus(lease, invocation.invocation_id, 'running');
        const result = await this.registry.execute(
          {
            authorized_context: authorized,
            turn_context: context,
            idempotency_key: idempotencyKey,
          },
          step,
          budget,
        );
        if (lease && invocation && invocation.status !== 'completed')
          await this.repository.setAgentInvocationStatus(lease, invocation.invocation_id, 'completed');
        activity.emit('tool_completed', descriptor.activity_label, {
          capability: descriptor.id,
          run_id: result.queued_run_ref?.run_id ?? null,
        });
        if (descriptor.creates_run) {
          // A mutation plan has already been preflighted as the only step. A
          // committed queued reference is the sole success signal; never
          // imply that a run exists after a failed mutation.
          if (!result.queued_run_ref || result.status !== 'pending')
            throw new CapabilityRegistryError('CAPABILITY_UNAVAILABLE');
          activity.emit('run_created', 'analysis_queued', {
            capability: descriptor.id,
            run_id: result.queued_run_ref.run_id,
          });
          return accepted(context, result.queued_run_ref.run_id, 'in_progress');
        }
        if (
          observations.length + result.observations.length >
            this.limits.max_composer_observations ||
          actions.length + result.available_workspace_actions.length >
            this.limits.max_workspace_actions
        )
          throw new CapabilityRegistryError('RUNTIME_LIMIT_EXCEEDED');
        const observationIds = new Set(
          observations.map((observation) => observation.observation_id),
        );
        if (
          result.observations.some((observation) => observationIds.has(observation.observation_id))
        )
          throw new CapabilityRegistryError('CAPABILITY_OUTPUT_INVALID');
        const actionIds = new Set(actions.map((action) => action.action_id));
        if (result.available_workspace_actions.some((action) => actionIds.has(action.action_id)))
          throw new CapabilityRegistryError('CAPABILITY_OUTPUT_INVALID');
        observations.push(...result.observations);
        actions.push(...result.available_workspace_actions);
        if (result.status === 'unavailable' || result.status === 'failed') {
          // The first unavailable result renders an unavailable answer. A
          // later safe read retains earlier canonical observations as partial.
          if (index === 0) actions.splice(0);
          break;
        }
        if (result.status === 'pending') break;
      }
      ensureWithinDeadline(deadline, requestSignal);
      if (!observations.length)
        return this.finalize(userId, context, 'completed', 'CAPABILITY_UNAVAILABLE', false, false, lease);
      activity.emit('answer_started', 'preparing_answer');
      const rendered = observations.every((observation) => observation.availability !== 'available')
        ? await deterministicGroundedAnswer({
            observations,
            available_workspace_actions: [],
            context: authorized,
            repository: this.repository,
          })
        : await this.compose(authorized, observations, actions, signal, stageCounters);
      ensureWithinDeadline(deadline, requestSignal);
      const result = await this.finalizeRendered(userId, context, authorized, rendered, lease);
      activity.emit('answer_completed', 'answer_ready', { run_id: rendered.primary_run_id });
      return result;
    } catch (error) {
      if (isTerminalTurnRace(error))
        return this.replayAccepted(userId, input, idempotencyKey, context.conversation_id);
      // Final persistence reauthorizes the actor. Once that check fails there
      // is no safe write path for a partial response, so let the BFF return a
      // non-disclosing authorization result rather than retrying finalization.
      if (isAuthorizationLoss(error)) throw new RuntimeContextError('NO_AUTHORIZED_RESULT');
      const code = errorCode(error);
      const status: Extract<MessageStatus, 'completed' | 'failed' | 'cancelled'> =
        code === 'TURN_CANCELLED' ? 'cancelled' : 'failed';
      activity.emit('error', 'safe_error', { error_code: code });
      return this.finalize(userId, context, status, code, retryable(error), true, lease,
        code === 'MISSING_CONTEXT' && resolveReportIntent(input) === 'update' ? 'Select the report you want to update.' : undefined);
    }
  }
}

import {
  CapabilityInvocationSchema,
  CapabilityResultV1Schema,
  CreateAnalysisCapabilityInputSchema,
  GetAnalysisResultCapabilityInputSchema,
  GetReportContextCapabilityInputSchema,
  InspectAgentCheckpointCapabilityInputSchema,
  InspectDecisionIntelligenceCapabilityInputSchema,
  InspectEvidenceCapabilityInputSchema,
  InspectPriorityEntityCapabilityInputSchema,
  InspectSignalCapabilityInputSchema,
  InspectVisualCapabilityInputSchema,
  type AgentCapabilityIdV1,
  type CapabilityInvocation,
  type CapabilityResultV1,
  type Role,
  type WorkspaceModeV1,
} from '@vda/contracts';
import { RepositoryError, type Repository } from '@vda/db';
import {
  AGENT_RUNTIME_LIMITS,
  MAX_AGENT_CAPABILITY_CALLS,
  MAX_AGENT_MUTATING_CAPABILITY_CALLS,
  MAX_AGENT_NEW_ANALYSIS_RUNS,
} from '../limits';
import type { AuthorizedAgentContextV1 } from '../context/types';
import {
  CapabilityRegistryError,
  type CapabilityDescriptor,
  type CapabilityExecutionBudget,
  type RequiredContext,
  type RuntimeCapabilityExecutionContext,
} from './contracts';
import { safeReadFailure } from './projection';
import { createAnalysis } from './create-analysis';
import { getAnalysisResult } from './get-analysis-result';
import { reportContext } from './get-report-context';
import { inspectAgentCheckpoint } from './inspect-agent-checkpoint';
import { inspectDecisionIntelligence } from './inspect-decision-intelligence';
import { inspectEvidence } from './inspect-evidence';
import { inspectPriorityEntity } from './inspect-priority-entity';
import { inspectSignal } from './inspect-signal';
import { inspectVisual } from './inspect-visual';

export { CapabilityRegistryError } from './contracts';
export type {
  CapabilityDescriptor,
  CapabilityExecutionBudget,
  RuntimeCapabilityExecutionContext,
} from './contracts';

const allRoles: readonly Role[] = ['owner', 'analyst', 'viewer'];

const writeRoles: readonly Role[] = ['owner', 'analyst'];

const bothModes: readonly WorkspaceModeV1[] = ['agent_chat', 'report_dashboard'];

export function createCapabilityExecutionBudget(): CapabilityExecutionBudget {
  return {
    total_calls: 0,
    mutation_calls: 0,
    new_analysis_runs: 0,
    calls_by_capability: new Map(),
  };
}

function defaultDescriptors(repository: Repository): CapabilityDescriptor[] {
  return [
    {
      id: 'create_analysis',
      version: 'v1',
      activity_label: 'starting_analysis',
      kind: 'mutation',
      allowed_roles: writeRoles,
      allowed_modes: bothModes,
      required_context: ['catalog'],
      max_calls_per_turn: 1,
      creates_run: true,
      input_schema: CreateAnalysisCapabilityInputSchema,
      execute: (context, input) => createAnalysis(repository, context, input),
    },
    {
      id: 'get_analysis_result',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: bothModes,
      required_context: ['run'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: GetAnalysisResultCapabilityInputSchema,
      execute: (context, input) => getAnalysisResult(repository, context, input),
    },
    {
      id: 'inspect_signal',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: bothModes,
      required_context: ['signal'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: InspectSignalCapabilityInputSchema,
      execute: (context, input) => inspectSignal(repository, context, input),
    },
    {
      id: 'inspect_decision_intelligence',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: bothModes,
      required_context: ['run', 'report', 'decision'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: InspectDecisionIntelligenceCapabilityInputSchema,
      execute: (context, input) => inspectDecisionIntelligence(repository, context, input),
    },
    {
      id: 'inspect_visual',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: ['report_dashboard'],
      required_context: ['chart'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: InspectVisualCapabilityInputSchema,
      execute: (context, input) => inspectVisual(repository, context, input),
    },
    {
      id: 'inspect_priority_entity',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: ['report_dashboard'],
      required_context: ['priority_entity'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: InspectPriorityEntityCapabilityInputSchema,
      execute: (context, input) => inspectPriorityEntity(repository, context, input),
    },
    {
      id: 'inspect_evidence',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: bothModes,
      required_context: ['evidence'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: InspectEvidenceCapabilityInputSchema,
      execute: (context, input) => inspectEvidence(repository, context, input),
    },
    {
      id: 'get_report_context',
      version: 'v1',
      activity_label: 'preparing_answer',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: bothModes,
      required_context: ['report'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: GetReportContextCapabilityInputSchema,
      execute: (context, input) => reportContext(repository, context, input),
    },
    {
      id: 'inspect_agent_checkpoint',
      version: 'v1',
      activity_label: 'inspecting_context',
      kind: 'read',
      allowed_roles: allRoles,
      allowed_modes: bothModes,
      required_context: ['agent_target'],
      max_calls_per_turn: 1,
      creates_run: false,
      input_schema: InspectAgentCheckpointCapabilityInputSchema,
      execute: (context, input) => inspectAgentCheckpoint(repository, context, input),
    },
  ];
}

function hasRequiredContext(context: AuthorizedAgentContextV1, required: RequiredContext) {
  switch (required) {
    case 'catalog':
      return context.allowed_scopes.length > 0;
    case 'run':
      return context.allowed_run_ids.length > 0;
    case 'signal':
      return context.allowed_signal_refs.length > 0;
    case 'decision':
      return context.active_decision !== null;
    case 'evidence':
      return context.allowed_evidence_refs.length > 0;
    case 'report':
      return context.allowed_report_refs.length > 0;
    case 'chart':
      return context.active_chart !== null;
    case 'priority_entity':
      return context.active_priority_entity !== null;
    case 'agent_target':
      return context.request.agent_target !== null;
  }
}

export class CapabilityRegistry {
  private readonly descriptors: ReadonlyMap<AgentCapabilityIdV1, CapabilityDescriptor>;

  constructor(
    private readonly repository: Repository,
    descriptors: readonly CapabilityDescriptor[] = defaultDescriptors(repository),
  ) {
    const byId = new Map<AgentCapabilityIdV1, CapabilityDescriptor>();
    for (const descriptor of descriptors) {
      if (byId.has(descriptor.id)) throw new Error(`DUPLICATE_CAPABILITY_ID:${descriptor.id}`);
      byId.set(descriptor.id, descriptor);
    }
    const requiredIds: AgentCapabilityIdV1[] = [
      'create_analysis',
      'get_analysis_result',
      'inspect_signal',
      'inspect_decision_intelligence',
      'inspect_visual',
      'inspect_priority_entity',
      'inspect_evidence',
      'get_report_context',
      'inspect_agent_checkpoint',
    ];
    if (byId.size !== requiredIds.length || requiredIds.some((id) => !byId.has(id)))
      throw new Error('CAPABILITY_REGISTRY_INVENTORY_INVALID');
    this.descriptors = byId;
  }

  available(context: AuthorizedAgentContextV1): AgentCapabilityIdV1[] {
    return [...this.descriptors.values()]
      .filter(
        (descriptor) =>
          descriptor.allowed_roles.includes(context.actor.role) &&
          descriptor.allowed_modes.includes(context.mode),
      )
      .map((descriptor) => descriptor.id);
  }

  descriptor(id: AgentCapabilityIdV1) {
    return this.descriptors.get(id) ?? null;
  }

  /** Validates a provider request before any executor has a chance to run. */
  preflight(context: AuthorizedAgentContextV1, invocationValue: CapabilityInvocation) {
    const invocation = CapabilityInvocationSchema.parse(invocationValue);
    const descriptor = this.descriptor(invocation.capability_id);
    if (!descriptor || !this.available(context).includes(invocation.capability_id))
      throw new CapabilityRegistryError('CAPABILITY_DENIED');
    for (const required of descriptor.required_context)
      if (!hasRequiredContext(context, required))
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    const input = descriptor.input_schema.parse(invocation.input) as Record<string, unknown>;
    const runId = typeof input.run_id === 'string' ? input.run_id : null;
    if (runId && !context.allowed_run_ids.includes(runId))
      throw new CapabilityRegistryError('CAPABILITY_DENIED');
    if (invocation.capability_id === 'inspect_signal') {
      if (
        !runId ||
        typeof input.signal_id !== 'string' ||
        !context.allowed_signal_refs.some(
          (reference) => reference.run_id === runId && reference.signal_id === input.signal_id,
        )
      )
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (invocation.capability_id === 'inspect_evidence') {
      if (
        !runId ||
        typeof input.artifact_id !== 'string' ||
        typeof input.evidence_path !== 'string' ||
        !context.allowed_evidence_refs.some(
          (reference) =>
            reference.run_id === runId &&
            reference.artifact_id === input.artifact_id &&
            reference.evidence_path === input.evidence_path,
        )
      )
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (invocation.capability_id === 'get_report_context') {
      if (
        !runId ||
        typeof input.report_id !== 'string' ||
        !context.allowed_report_refs.some(
          (reference) => reference.run_id === runId && reference.report_id === input.report_id,
        )
      )
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (invocation.capability_id === 'inspect_decision_intelligence') {
      if (!runId || context.active_report?.run_id !== runId)
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (invocation.capability_id === 'inspect_visual') {
      if (
        !runId ||
        typeof input.chart_id !== 'string' ||
        context.active_chart?.run_id !== runId ||
        context.active_chart.chart_id !== input.chart_id
      )
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (invocation.capability_id === 'inspect_priority_entity') {
      if (
        !runId ||
        typeof input.priority_entity_id !== 'string' ||
        context.active_priority_entity?.run_id !== runId ||
        context.active_priority_entity.priority_entity_id !== input.priority_entity_id
      )
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (invocation.capability_id === 'inspect_agent_checkpoint') {
      if (input.agent_target !== context.request.agent_target)
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    return { invocation, descriptor, input };
  }

  async execute(
    context: RuntimeCapabilityExecutionContext,
    invocationValue: CapabilityInvocation,
    budget: CapabilityExecutionBudget,
  ) {
    const { descriptor, input } = this.preflight(context.authorized_context, invocationValue);
    const used = budget.calls_by_capability.get(descriptor.id) ?? 0;
    if (
      budget.total_calls >= MAX_AGENT_CAPABILITY_CALLS ||
      used >= descriptor.max_calls_per_turn ||
      used >= AGENT_RUNTIME_LIMITS.max_invocations_per_capability ||
      (descriptor.kind === 'mutation' &&
        budget.mutation_calls >= MAX_AGENT_MUTATING_CAPABILITY_CALLS) ||
      (descriptor.creates_run && budget.new_analysis_runs >= MAX_AGENT_NEW_ANALYSIS_RUNS)
    )
      throw new CapabilityRegistryError('RUNTIME_LIMIT_EXCEEDED');
    // Membership and write policy can change after plan preflight. Recheck
    // immediately before every data-plane call, especially a mutation.
    let role: Role;
    try {
      role = await this.repository.authorize(
        context.authorized_context.actor.user_id,
        context.authorized_context.org_id,
        descriptor.kind === 'mutation',
      );
    } catch {
      // Treat a membership/write-policy change as authorization loss. It is
      // never safe to return earlier facts after this recheck fails.
      throw new CapabilityRegistryError('CAPABILITY_DENIED');
    }
    if (!descriptor.allowed_roles.includes(role))
      throw new CapabilityRegistryError('CAPABILITY_DENIED');
    budget.total_calls++;
    budget.calls_by_capability.set(descriptor.id, used + 1);
    if (descriptor.kind === 'mutation') budget.mutation_calls++;
    if (descriptor.creates_run) budget.new_analysis_runs++;
    let result: CapabilityResultV1;
    try {
      result = await descriptor.execute(context, input);
    } catch (error) {
      if (error instanceof CapabilityRegistryError) throw error;
      if (error instanceof RepositoryError && error.status === 403)
        throw new CapabilityRegistryError('CAPABILITY_DENIED');
      if (descriptor.kind === 'read') return safeReadFailure(descriptor.id);
      throw new CapabilityRegistryError('CAPABILITY_UNAVAILABLE');
    }
    try {
      return CapabilityResultV1Schema.parse(result);
    } catch {
      throw new CapabilityRegistryError('CAPABILITY_OUTPUT_INVALID');
    }
  }
}

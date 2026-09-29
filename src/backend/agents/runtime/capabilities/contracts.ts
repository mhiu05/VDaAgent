import type {
  AgentCapabilityIdV1,
  CapabilityResultV1,
  Role,
  WorkspaceModeV1,
} from '@vda/contracts';
import type { TurnContext } from '@vda/db';
import type { AuthorizedAgentContextV1 } from '../context/types';

export type InputParser = { parse(input: unknown): unknown };

export type RequiredContext =
  | 'run'
  | 'signal'
  | 'decision'
  | 'evidence'
  | 'report'
  | 'chart'
  | 'priority_entity'
  | 'agent_target'
  | 'catalog';

export type CapabilityDescriptor = {
  id: AgentCapabilityIdV1;
  version: 'v1';
  activity_label:
    'inspecting_context' | 'starting_analysis' | 'analysis_queued' | 'preparing_answer';
  kind: 'read' | 'mutation';
  allowed_roles: readonly Role[];
  allowed_modes: readonly WorkspaceModeV1[];
  required_context: readonly RequiredContext[];
  max_calls_per_turn: number;
  creates_run: boolean;
  input_schema: InputParser;
  execute: (
    context: RuntimeCapabilityExecutionContext,
    input: unknown,
  ) => Promise<CapabilityResultV1>;
};

export type RuntimeCapabilityExecutionContext = {
  authorized_context: AuthorizedAgentContextV1;
  turn_context: TurnContext;
  idempotency_key: string;
};

export type CapabilityExecutionBudget = {
  total_calls: number;
  mutation_calls: number;
  new_analysis_runs: number;
  calls_by_capability: Map<AgentCapabilityIdV1, number>;
};

export class CapabilityRegistryError extends Error {
  constructor(
    readonly code:
      | 'CAPABILITY_DENIED'
      | 'CAPABILITY_UNAVAILABLE'
      | 'CAPABILITY_OUTPUT_INVALID'
      | 'RUNTIME_LIMIT_EXCEEDED',
  ) {
    super(code);
  }
}

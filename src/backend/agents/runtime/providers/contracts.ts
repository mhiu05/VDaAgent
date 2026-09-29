import type {
  AgentPlanV1,
  CapabilityName,
  AvailableWorkspaceActionV1,
  CanonicalAgentObservationV1,
  GroundedResponseSelectionV1,
} from '@vda/contracts';
import type { AgentRuntimeProvider as ConfiguredAgentRuntimeProvider } from '@vda/config';

export type AgentRuntimeProviderName = ConfiguredAgentRuntimeProvider | 'fallback';

export type RuntimeProviderMetadata = {
  provider: AgentRuntimeProviderName;
  model: string;
  request_id: string | null;
  latency_ms: number;
  http_status: number | null;
  zero_data_retention: boolean | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  fallback_from: ConfiguredAgentRuntimeProvider | null;
};

export type AgentRuntimeProviderResult<T> = {
  value: T;
  metadata: RuntimeProviderMetadata;
};

/** Server-owned, bounded projections only. Never include raw rows or secrets. */
export type AgentRuntimePlannerInput = {
  question: string;
  context: Record<string, unknown>;
  capabilities: CapabilityName[];
};

/**
 * The composer receives only non-factual observation metadata needed to rank
 * IDs. Canonical text, values, grounding references, and action payloads
 * never enter this provider contract: the renderer rehydrates those
 * server-side after an ID selection has been validated.
 */
export type AgentRuntimeComposerObservation = Pick<
  CanonicalAgentObservationV1,
  'observation_id' | 'kind' | 'availability' | 'support_level'
>;
export type AgentRuntimeComposerWorkspaceAction = Pick<AvailableWorkspaceActionV1, 'action_id'>;
export type AgentRuntimeComposerInput = {
  observations: AgentRuntimeComposerObservation[];
  available_workspace_actions: AgentRuntimeComposerWorkspaceAction[];
};

export type AgentRuntimeComposerValidator = (
  response: GroundedResponseSelectionV1,
) => void | Promise<void>;
export type AgentRuntimePlannerValidator = (plan: AgentPlanV1) => void | Promise<void>;

export interface AgentRuntimeProvider {
  readonly provider: AgentRuntimeProviderName;
  readonly model: string;
  plan(
    input: AgentRuntimePlannerInput,
    signal?: AbortSignal,
    validate?: AgentRuntimePlannerValidator,
  ): Promise<AgentRuntimeProviderResult<AgentPlanV1>>;
  compose(
    input: AgentRuntimeComposerInput,
    signal?: AbortSignal,
    validate?: AgentRuntimeComposerValidator,
  ): Promise<AgentRuntimeProviderResult<GroundedResponseSelectionV1>>;
}

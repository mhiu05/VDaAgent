import {
  AgentActivityEventV1Schema,
  type AgentActivityEventV1,
  type AgentRuntimeErrorCode,
  type CapabilityName,
} from '@vda/contracts';

export type AgentActivitySink = (event: AgentActivityEventV1) => void;

/**
 * Runtime activity is deliberately a public, bounded projection. Provider
 * prompts, plans, observations, and error details never become activity data.
 */
export class AgentActivityEmitter {
  private sequence = 0;

  constructor(private readonly sink: AgentActivitySink = () => undefined) {}

  emit(
    type: AgentActivityEventV1['type'],
    label: AgentActivityEventV1['label'],
    values: {
      capability?: CapabilityName | null;
      run_id?: string | null;
      artifact_id?: string | null;
      error_code?: AgentRuntimeErrorCode | null;
    } = {},
  ) {
    const event = AgentActivityEventV1Schema.parse({
      version: 'agent-activity-v1',
      sequence: this.sequence++,
      type,
      label,
      capability: values.capability ?? null,
      run_id: values.run_id ?? null,
      artifact_id: values.artifact_id ?? null,
      error_code: values.error_code ?? null,
    });
    this.sink(event);
    return event;
  }
}

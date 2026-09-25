import { InspectAgentCheckpointCapabilityInputSchema } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { getAgentTargetFollowUp } from '../../chat/operations';
import { CapabilityRegistryError, type RuntimeCapabilityExecutionContext } from './contracts';
import {
  legacyToolContext,
  unavailable,
  groundingFromMessagePart,
  capabilityResult,
  observation,
  boundedGroundingRefs,
  runRef,
} from './projection';

export async function inspectAgentCheckpoint(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = InspectAgentCheckpointCapabilityInputSchema.parse(input);
  if (context.authorized_context.request.agent_target !== parsed.agent_target)
    throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const result = await getAgentTargetFollowUp(repository, legacyToolContext(context));
  if (result.kind === 'agent_target_unavailable')
    return unavailable('inspect_agent_checkpoint', 'inspect_agent_checkpoint-1');
  const grounding = result.parts.flatMap((part) => groundingFromMessagePart(part));
  return capabilityResult('inspect_agent_checkpoint', 'available', [
    observation(
      'inspect_agent_checkpoint-1',
      'status',
      'available',
      result.content,
      boundedGroundingRefs(
        grounding.length ? grounding : [{ type: 'run', ref: runRef(result.run) }],
      ),
    ),
  ]);
}

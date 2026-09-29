import { InspectSignalCapabilityInputSchema } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { CapabilityRegistryError, type RuntimeCapabilityExecutionContext } from './contracts';
import { visibleEvidence, boundedGroundingRefs, capabilityResult, observation } from './projection';

export async function inspectSignal(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = InspectSignalCapabilityInputSchema.parse(input);
  const authorized = context.authorized_context;
  if (
    !authorized.allowed_signal_refs.some(
      (item) => item.run_id === parsed.run_id && item.signal_id === parsed.signal_id,
    )
  )
    throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const brief = await repository.decisionBrief(
    authorized.actor.user_id,
    authorized.org_id,
    parsed.run_id,
  );
  const signal = [
    ...brief.decision_brief.current_state,
    ...brief.decision_brief.material_changes,
    ...brief.decision_brief.where_to_look,
    ...brief.decision_brief.data_quality,
  ].find((item) => item.signal_id === parsed.signal_id);
  if (!signal) throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const refs = await visibleEvidence(repository, authorized, parsed.run_id, signal.evidence);
  const grounding = boundedGroundingRefs([
    { type: 'run', ref: { run_id: parsed.run_id, status: 'succeeded' } },
    ...refs.map((ref) => ({ type: 'evidence', ref })),
  ]);
  return capabilityResult(
    'inspect_signal',
    signal.status === 'available' ? 'available' : 'unavailable',
    [
      observation(
        'inspect_signal-1',
        'claim',
        signal.status === 'available' ? 'available' : 'unavailable',
        signal.label,
        grounding,
      ),
    ],
    signal.status === 'available' ? {} : { error_code: 'CAPABILITY_UNAVAILABLE' },
  );
}

import { InspectEvidenceCapabilityInputSchema, type EvidenceRefV1 } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { readArtifactPath } from '@vda/domain';
import { CapabilityRegistryError, type RuntimeCapabilityExecutionContext } from './contracts';
import {
  unavailable,
  canonicalEvidenceValue,
  capabilityResult,
  observation,
  artifactRef,
} from './projection';

export async function inspectEvidence(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = InspectEvidenceCapabilityInputSchema.parse(input);
  const authorized = context.authorized_context;
  if (
    !authorized.allowed_evidence_refs.some(
      (item) =>
        item.run_id === parsed.run_id &&
        item.artifact_id === parsed.artifact_id &&
        item.evidence_path === parsed.evidence_path,
    )
  )
    throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const artifact = await repository.publicArtifactById(
    authorized.actor.user_id,
    authorized.org_id,
    parsed.run_id,
    parsed.artifact_id,
  );
  const ref: EvidenceRefV1 = {
    run_id: parsed.run_id,
    artifact_id: parsed.artifact_id,
    evidence_path: parsed.evidence_path,
  };
  let evidenceValue: unknown;
  try {
    evidenceValue = readArtifactPath(artifact, parsed.evidence_path);
  } catch {
    return unavailable('inspect_evidence', 'inspect_evidence-unavailable');
  }
  const displayValue = canonicalEvidenceValue(evidenceValue);
  if (displayValue === null)
    return unavailable(
      'inspect_evidence',
      'inspect_evidence-unavailable',
      'The selected public evidence is unavailable in a bounded display form.',
    );
  return capabilityResult(
    'inspect_evidence',
    'available',
    [
      observation(
        'inspect_evidence-value',
        'metric',
        'available',
        `Public evidence at ${parsed.evidence_path}.`,
        [
          { type: 'run', ref: { run_id: parsed.run_id, status: 'succeeded' } },
          { type: 'artifact', ref: artifactRef(artifact) },
          { type: 'evidence', ref },
        ],
        { display_value: displayValue },
      ),
    ],
    {
      available_workspace_actions: [
        {
          action_id: 'inspect-evidence-open',
          action: {
            type: 'open_evidence',
            run_id: parsed.run_id,
            artifact_id: parsed.artifact_id,
            evidence_path: parsed.evidence_path,
          },
        },
      ],
    },
  );
}

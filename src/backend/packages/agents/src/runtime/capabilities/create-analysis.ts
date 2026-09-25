import { CreateAnalysisCapabilityInputSchema } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { createAnalysisTool } from '../../chat/operations';
import { CapabilityRegistryError, type RuntimeCapabilityExecutionContext } from './contracts';
import { legacyToolContext, runRef, capabilityResult, observation } from './projection';

export async function createAnalysis(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = CreateAnalysisCapabilityInputSchema.parse(input);
  const result = await createAnalysisTool(repository, legacyToolContext(context), {
    action: 'create_analysis',
    focus: parsed.focus ?? 'current_inventory',
  });
  if (result.kind !== 'created_analysis')
    throw new CapabilityRegistryError('CAPABILITY_UNAVAILABLE');
  const queued = runRef(result.run);
  return capabilityResult(
    'create_analysis',
    'pending',
    [
      observation('create_analysis-1', 'status', 'pending', 'Analysis queued.', [
        { type: 'run', ref: queued },
      ]),
    ],
    { queued_run_ref: queued },
  );
}

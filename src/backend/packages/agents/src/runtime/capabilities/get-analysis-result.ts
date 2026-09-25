import { GetAnalysisResultCapabilityInputSchema } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { type RuntimeCapabilityExecutionContext } from './contracts';
import { requireAllowedRun, runRef, capabilityResult, observation } from './projection';

export async function getAnalysisResult(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = GetAnalysisResultCapabilityInputSchema.parse(input);
  const authorized = context.authorized_context;
  requireAllowedRun(authorized, parsed.run_id);
  const run = await repository.getRun(authorized.actor.user_id, authorized.org_id, parsed.run_id);
  const state =
    run.run.status === 'succeeded'
      ? 'available'
      : run.run.status === 'queued' || run.run.status === 'running'
        ? 'pending'
        : 'unavailable';
  const text =
    state === 'available'
      ? 'Analysis result is available.'
      : state === 'pending'
        ? 'Analysis is pending.'
        : 'Analysis is unavailable.';
  return capabilityResult(
    'get_analysis_result',
    state,
    [
      observation('get_analysis_result-1', 'status', state, text, [
        { type: 'run', ref: runRef(run.run) },
      ]),
    ],
    {
      queued_run_ref: state === 'pending' ? runRef(run.run) : null,
      error_code: state === 'unavailable' ? 'CAPABILITY_UNAVAILABLE' : null,
    },
  );
}

import { GetReportContextCapabilityInputSchema } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { CapabilityRegistryError, type RuntimeCapabilityExecutionContext } from './contracts';
import {
  unavailable,
  artifactRef,
  observation,
  boundedCanonicalText,
  capabilityResult,
} from './projection';

export async function reportContext(
  repository: Repository,
  context: RuntimeCapabilityExecutionContext,
  input: unknown,
) {
  const parsed = GetReportContextCapabilityInputSchema.parse(input);
  const authorized = context.authorized_context;
  const report = authorized.allowed_report_refs.find(
    (item) => item.run_id === parsed.run_id && item.report_id === parsed.report_id,
  );
  if (!report) throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const record = await repository.getReport(
    authorized.actor.user_id,
    authorized.org_id,
    report.report_id,
  );
  if (record.report.run_id !== report.run_id)
    throw new CapabilityRegistryError('CAPABILITY_DENIED');
  const artifact = await repository.publicArtifactById(
    authorized.actor.user_id,
    authorized.org_id,
    report.run_id,
    record.report.artifact_id,
  );
  if (artifact.kind !== 'report') return unavailable('get_report_context', 'get_report_context-1');
  const grounding = [
    { type: 'run', ref: { run_id: report.run_id, status: 'succeeded' } },
    { type: 'artifact', ref: artifactRef(artifact) },
  ];
  const observations = [
    observation(
      'get_report_context-summary',
      'status',
      'available',
      boundedCanonicalText(
        artifact.payload.summary,
        'Published report summary is available.',
        1_100,
      ),
      grounding,
    ),
    ...artifact.payload.sections
      .slice(0, 8)
      .map((section, index) =>
        observation(
          `get_report_context-section-${index + 1}`,
          section.status === 'unavailable' ? 'limitation' : 'status',
          section.status === 'available' ? 'available' : 'unavailable',
          `${boundedCanonicalText(section.title, section.key, 700)} is ${section.status}.`,
          grounding,
        ),
      ),
  ];
  return capabilityResult(
    'get_report_context',
    observations.some((item) => item.availability === 'available') ? 'available' : 'unavailable',
    observations,
    {
      available_workspace_actions: [
        {
          action_id: 'get-report-context-open-dashboard',
          action: { type: 'open_dashboard', run_id: report.run_id, report_id: report.report_id },
        },
      ],
      error_code: observations.some((item) => item.availability === 'available')
        ? null
        : 'CAPABILITY_UNAVAILABLE',
    },
  );
}

import type { Artifact, ArtifactValidation, RunTask } from '@vda/contracts';

const previewKinds = new Set<Artifact['kind']>([
  'data_analysis_pack', 'comparison_pack', 'chart_pack', 'visual_evidence',
  'analysis_pack', 'insight_pack',
]);

/** Values appear in the timeline only after their matching stage and validation succeed. */
export function validatedPreviews(
  orgId: string,
  runId: string,
  tasks: RunTask[],
  artifacts: Artifact[],
  validations: ArtifactValidation[],
) {
  const succeeded = new Set(tasks.filter((task) => task.org_id === orgId && task.run_id === runId && task.status === 'succeeded').map((task) => task.task_id));
  const valid = new Set(validations.filter((entry) => entry.org_id === orgId && entry.run_id === runId && entry.valid).map((entry) => entry.artifact_id));
  return artifacts.filter((artifact) => artifact.org_id === orgId && artifact.run_id === runId &&
    previewKinds.has(artifact.kind) && succeeded.has(artifact.task_id) && valid.has(artifact.artifact_id));
}

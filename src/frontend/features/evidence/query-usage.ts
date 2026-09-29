import type { AnalysisRun, Artifact, ArtifactValidation } from '@vda/contracts';

/** Count persisted queries with a validated result, independently of publication. */
export function projectQueryUsage(
  run: Pick<AnalysisRun, 'org_id' | 'run_id'>,
  artifacts: readonly Artifact[],
  validations: readonly ArtifactValidation[],
): { used: number; total: number } | null {
  const scoped = artifacts.filter(artifact => artifact.org_id === run.org_id && artifact.run_id === run.run_id);
  const queries = new Set(scoped.filter(artifact => artifact.kind === 'query').map(artifact => artifact.artifact_id));
  // An empty/redacted/unloaded bundle cannot establish a zero query count.
  if (!queries.size) return null;
  const valid = new Set(validations.filter(validation => validation.org_id === run.org_id &&
    validation.run_id === run.run_id && validation.valid).map(validation => validation.artifact_id));
  const used = new Set(scoped.filter(artifact => artifact.kind === 'query_result' && valid.has(artifact.artifact_id))
    .flatMap(artifact => artifact.input_refs).filter(id => queries.has(id) && valid.has(id)));
  return { used: used.size, total: queries.size };
}

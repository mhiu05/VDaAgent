import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactSchema,
  LIMITATION,
  SEMANTIC_VERSION,
  type Artifact,
  type ArtifactKind,
  type ArtifactOf,
  type RunTask,
} from '@vda/contracts';
import { artifactHash, stableId, verifyArtifact } from '@vda/domain';
import type { StageContext } from './stage-context';

export type ArtifactRefs = { snapshots?: string[]; sources?: string[] };
const unique = (values: readonly string[]) => [...new Set(values)].sort();
export async function persistStageArtifact<K extends ArtifactKind>(
  context: StageContext,
  input: {
    kind: K;
    key: string;
    task: RunTask;
    payload: ArtifactOf<K>['payload'];
    inputs: Artifact[];
    refs?: ArtifactRefs;
    limitations?: string[];
    checks?: string[];
  },
): Promise<ArtifactOf<K>> {
  const { run, repository, lease } = context;
  await repository.assertLease(lease);
  const body = {
    artifact_id: stableId(`${run.run_id}:artifact:${input.key}`),
    org_id: run.org_id,
    run_id: run.run_id,
    task_id: input.task.task_id,
    kind: input.kind,
    schema_version: ARTIFACT_SCHEMA_VERSION,
    created_at: run.created_at,
    semantic_version: SEMANTIC_VERSION,
    provisional: true as const,
    data_as_of: run.request.data_as_of,
    input_refs: unique(input.inputs.map((artifact) => artifact.artifact_id)),
    snapshot_refs: unique(
      input.refs?.snapshots ?? input.inputs.flatMap((artifact) => artifact.snapshot_refs),
    ),
    source_refs: unique(
      input.refs?.sources ?? input.inputs.flatMap((artifact) => artifact.source_refs),
    ),
    limitations: unique(input.limitations?.length ? input.limitations : [LIMITATION]),
    payload: input.payload,
  };
  const artifact = ArtifactSchema.parse({
    ...body,
    content_hash: artifactHash(body as Omit<Artifact, 'content_hash'>),
  }) as ArtifactOf<K>;
  verifyArtifact(artifact);
  const persisted = (await repository.storeArtifact(lease, artifact, {
    artifact_key: input.key,
  })) as ArtifactOf<K>;
  verifyArtifact(persisted);
  await repository.validateArtifact(lease, {
    artifact_id: persisted.artifact_id,
    org_id: run.org_id,
    run_id: run.run_id,
    validated_at: new Date().toISOString(),
    validator_version: 'mvp-validator-v1',
    valid: true,
    checks: input.checks ?? ['schema', 'hash', 'tenant', 'lineage'],
  });
  return persisted;
}

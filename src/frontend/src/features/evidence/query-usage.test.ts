import { describe, expect, it } from 'vitest';
import type { Artifact, ArtifactValidation } from '@vda/contracts';
import { projectQueryUsage } from './query-usage';

const run = { org_id: 'org', run_id: 'run' };
// Only persisted identity, kind and lineage are read by this projection.
const artifact = (artifact_id: string, kind: Artifact['kind'], input_refs: string[] = [], scope = run) =>
  ({ ...scope, artifact_id, kind, input_refs }) as Artifact;
const validation = (artifact_id: string, valid = true, scope = run) =>
  ({ ...scope, artifact_id, valid }) as ArtifactValidation;
const query = artifact('query', 'query');
const result = artifact('result', 'query_result', ['query']);
const valid = [validation('query'), validation('result')];

describe('persisted query usage projection', () => {
  it('counts Data results when Insight/report artifacts do not exist', () => {
    expect(projectQueryUsage(run, [query, result], valid)).toEqual({ used: 1, total: 1 });
  });
  it('counts unique queries, not rows, results, evidence references or runtime calls', () => {
    const secondResult = artifact('result2', 'query_result', ['query', 'query']);
    expect(projectQueryUsage(run, [query, query, artifact('unused', 'query'), result, secondResult,
      artifact('evidence', 'data_analysis_pack', ['query'])], [...valid, validation('result2')]))
      .toEqual({ used: 1, total: 2 });
  });
  it('does not count missing or unvalidated result lineage as used', () => {
    expect(projectQueryUsage(run, [query], valid)).toEqual({ used: 0, total: 1 });
    expect(projectQueryUsage(run, [query, result], [validation('query'), validation('result', false)]))
      .toEqual({ used: 0, total: 1 });
    expect(projectQueryUsage(run, [query, artifact('result', 'query_result', ['other-query'])], valid))
      .toEqual({ used: 0, total: 1 });
  });
  it('rejects stale run/tenant artifacts and validations', () => {
    for (const scope of [{ ...run, run_id: 'other-run' }, { ...run, org_id: 'other-org' }]) {
      expect(projectQueryUsage(run, [query, artifact('result', 'query_result', ['query'], scope)], valid))
        .toEqual({ used: 0, total: 1 });
      expect(projectQueryUsage(run, [query, result], [validation('query'), validation('result', true, scope)]))
        .toEqual({ used: 0, total: 1 });
      expect(projectQueryUsage(scope, [query, result], valid)).toBeNull();
    }
  });
  it('leaves unloaded/redacted metadata unknown instead of inventing 0 / 0', () => {
    expect(projectQueryUsage(run, [], [])).toBeNull();
    expect(projectQueryUsage(run, [artifact('evidence', 'data_analysis_pack')], [])).toBeNull();
  });
});

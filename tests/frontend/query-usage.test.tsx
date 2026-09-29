import { describe, expect, it } from 'vitest';
import type { Artifact, ArtifactValidation } from '@vda/contracts';
import { projectQueryUsage } from '../../src/frontend/features/evidence/query-usage';

const run = { org_id: 'org', run_id: 'run' };
const artifact = (id: string, kind: Artifact['kind'], refs: string[] = [], scope = run) =>
  ({ ...scope, artifact_id: id, kind, input_refs: refs }) as Artifact;
const validation = (id: string, valid = true, scope = run) =>
  ({ ...scope, artifact_id: id, valid }) as ArtifactValidation;
const query = artifact('query', 'query');
const result = artifact('result', 'query_result', ['query']);

describe('persisted query usage', () => {
  it('counts unique validated Data queries without Insight or a report', () => {
    expect(
      projectQueryUsage(run, [query, result], [validation('query'), validation('result')]),
    ).toEqual({ used: 1, total: 1 });
    expect(
      projectQueryUsage(
        run,
        [
          query,
          query,
          artifact('unused', 'query'),
          result,
          artifact('result2', 'query_result', ['query', 'query']),
        ],
        [validation('query'), validation('result'), validation('result2')],
      ),
    ).toEqual({ used: 1, total: 2 });
  });

  it('does not treat missing, invalid or foreign results as used', () => {
    expect(projectQueryUsage(run, [query], [validation('query')])).toEqual({ used: 0, total: 1 });
    expect(
      projectQueryUsage(run, [query, result], [validation('query'), validation('result', false)]),
    ).toEqual({ used: 0, total: 1 });
    expect(
      projectQueryUsage(
        run,
        [query, artifact('result', 'query_result', ['query'], { ...run, org_id: 'foreign' })],
        [validation('query'), validation('result')],
      ),
    ).toEqual({ used: 0, total: 1 });
    expect(
      projectQueryUsage(
        run,
        [query, result],
        [validation('query'), validation('result', true, { ...run, run_id: 'foreign' })],
      ),
    ).toEqual({ used: 0, total: 1 });
  });

  it('keeps absent or redacted metadata unknown', () => {
    expect(projectQueryUsage(run, [], [])).toBeNull();
    expect(projectQueryUsage(run, [artifact('pack', 'data_analysis_pack')], [])).toBeNull();
  });
});

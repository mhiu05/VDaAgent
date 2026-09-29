import { describe, expect, it } from 'vitest';
import type { Artifact, ArtifactValidation, RunTask } from '@vda/contracts';
import { validatedPreviews } from '../../src/frontend/features/analysis/models/artifact-preview';

const task = (id: string, status: RunTask['status'], run_id = 'run') =>
  ({ task_id: id, org_id: 'org', run_id, status }) as RunTask;
const artifact = (id: string, task_id: string, run_id = 'run') =>
  ({ artifact_id: id, org_id: 'org', run_id, task_id, kind: 'data_analysis_pack' }) as Artifact;
const validation = (id: string, valid: boolean, run_id = 'run') =>
  ({ artifact_id: id, org_id: 'org', run_id, valid }) as ArtifactValidation;

describe('timeline artifact publication', () => {
  it('shows only validated output from a succeeded task in the selected run', () => {
    const tasks = [
      task('done', 'succeeded'),
      task('active', 'running'),
      task('foreign', 'succeeded', 'other'),
    ];
    const artifacts = [
      artifact('good', 'done'),
      artifact('invalid', 'done'),
      artifact('early', 'active'),
      artifact('foreign', 'foreign', 'other'),
    ];
    const validations = [
      validation('good', true),
      validation('invalid', false),
      validation('early', true),
      validation('foreign', true, 'other'),
    ];
    expect(
      validatedPreviews('org', 'run', tasks, artifacts, validations).map(
        (item) => item.artifact_id,
      ),
    ).toEqual(['good']);
  });
});

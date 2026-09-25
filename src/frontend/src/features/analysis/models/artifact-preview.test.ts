import { describe, expect, it } from 'vitest';
import type { Artifact, ArtifactValidation, RunTask } from '@vda/contracts';
import { validatedPreviews } from './artifact-preview';

const task = (id: string, status: RunTask['status'], run = 'run'): RunTask =>
  ({ task_id: id, org_id: 'org', run_id: run, status } as RunTask);
const artifact = (id: string, taskId: string, run = 'run'): Artifact =>
  ({ artifact_id: id, org_id: 'org', run_id: run, task_id: taskId, kind: 'data_analysis_pack' } as Artifact);
const validation = (id: string, valid: boolean, run = 'run'): ArtifactValidation =>
  ({ artifact_id: id, org_id: 'org', run_id: run, valid } as ArtifactValidation);

describe('validatedPreviews', () => {
  it('shows only matching, validated output from a succeeded task', () => {
    const tasks = [task('done', 'succeeded'), task('active', 'running'), task('other', 'succeeded', 'other-run')];
    const artifacts = [artifact('good', 'done'), artifact('invalid', 'done'), artifact('early', 'active'), artifact('other-run', 'other', 'other-run')];
    const validations = [validation('good', true), validation('invalid', false), validation('early', true), validation('other-run', true, 'other-run')];
    expect(validatedPreviews('org', 'run', tasks, artifacts, validations).map((item) => item.artifact_id)).toEqual(['good']);
  });
});

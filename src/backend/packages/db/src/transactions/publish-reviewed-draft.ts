import { randomUUID } from 'node:crypto';
import {
  ArtifactSchema,
  ArtifactValidationSchema,
  RunTaskSchema,
  type Artifact,
  type ArtifactOf,
  type ArtifactValidation,
  type ReportRecord,
  type RunEvent,
  type RunTask,
} from '@vda/contracts';
import { stableId, validateAgentPublication } from '@vda/domain';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { insertBatches } from '../internal/insert-batches';
import { json } from '../mapping/rows';
import { updateRun } from '../repositories/run-repository';
import { finishRunAssistant } from '../workflow/checkpoint-repository';
import { syncAgentInvocationsFromRun } from '../workflow/agent-projection';
import { fenceRun } from '../workflow/lease-repository';
import type { Lease, ReviewedDraftPublication } from '../types';

const now = () => new Date().toISOString();

export async function publishReviewedDraft(
  db: Driver,
  lease: Lease,
  input: ReviewedDraftPublication,
): Promise<ReportRecord> {
  const report = ArtifactSchema.parse(input.report);
  const publicationTask = RunTaskSchema.parse(input.publication_task);
  if (report.kind !== 'report') fail('INVALID_REPORT', 422);
  return db.transaction(async (tx) => {
    const run = await fenceRun(tx, lease);
    if (run.workflow_version !== 'agent-v1') fail('AGENT_PUBLICATION_NOT_SELECTED', 409);
    if (run.report_artifact_id !== null) fail('DUPLICATE_PUBLICATION', 409);
    if (
      publicationTask.org_id !== run.org_id ||
      publicationTask.run_id !== run.run_id ||
      publicationTask.task_id !== stableId(`${run.run_id}:task:publication`) ||
      publicationTask.kind !== 'publication' ||
      publicationTask.status !== 'running' ||
      publicationTask.attempt !== run.attempt ||
      publicationTask.dependencies.length !== 1 ||
      publicationTask.dependencies[0] !== 'reviewer'
    ) {
      fail('INVALID_PUBLICATION_TASK', 422);
    }
    const persistedTaskRows = await tx.query(
      'SELECT payload FROM tasks WHERE org_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',
      [run.org_id, run.run_id, publicationTask.task_id],
    );
    const persistedTask = RunTaskSchema.safeParse(json(persistedTaskRows[0] ?? {}));
    if (
      !persistedTask.success ||
      persistedTask.data.org_id !== run.org_id ||
      persistedTask.data.run_id !== run.run_id ||
      persistedTask.data.task_id !== stableId(`${run.run_id}:task:publication`) ||
      persistedTask.data.kind !== 'publication' ||
      persistedTask.data.status !== 'running' ||
      persistedTask.data.attempt !== run.attempt ||
      persistedTask.data.dependencies.length !== 1 ||
      persistedTask.data.dependencies[0] !== 'reviewer'
    )
      fail('INVALID_PUBLICATION_TASK', 422);

    // Recheck both predecessors while holding the run fence. The caller's
    // in-memory stage context is advisory only: publication is authorized
    // by these persisted, successful Report and Reviewer checkpoints.
    const predecessorRequirements = [
      { kind: 'report', dependencies: ['insight'] },
      { kind: 'reviewer', dependencies: ['report'] },
    ] as const;
    for (const requirement of predecessorRequirements) {
      const taskId = stableId(`${run.run_id}:task:${requirement.kind}`);
      const rows = await tx.query(
        'SELECT payload FROM tasks WHERE org_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',
        [run.org_id, run.run_id, taskId],
      );
      const task = RunTaskSchema.safeParse(json(rows[0] ?? {}));
      if (
        !task.success ||
        task.data.task_id !== taskId ||
        task.data.org_id !== run.org_id ||
        task.data.run_id !== run.run_id ||
        task.data.kind !== requirement.kind ||
        task.data.status !== 'succeeded' ||
        task.data.attempt !== run.attempt ||
        task.data.error_code !== null ||
        task.data.dependencies.length !== requirement.dependencies.length ||
        task.data.dependencies.some(
          (dependency, index) => dependency !== requirement.dependencies[index],
        )
      )
        fail('INVALID_PUBLICATION_PREDECESSOR', 422);
    }

    const existingReportArtifact = await tx.query(
      'SELECT id FROM artifacts WHERE org_id=$1 AND run_id=$2 AND artifact_key=$3',
      [run.org_id, run.run_id, 'report'],
    );
    const existingRecord = await tx.query('SELECT id FROM reports WHERE org_id=$1 AND run_id=$2', [
      run.org_id,
      run.run_id,
    ]);
    if (existingReportArtifact[0] || existingRecord[0]) fail('DUPLICATE_PUBLICATION', 409);

    const artifactRows = await tx.query(
      'SELECT id,artifact_key,payload FROM artifacts WHERE org_id=$1 AND run_id=$2',
      [run.org_id, run.run_id],
    );
    const artifacts = artifactRows.map((row) => ArtifactSchema.parse(json(row))) as Artifact[];
    const artifactKeys = new Map(
      artifactRows.map((row) => [String(row.id), String(row.artifact_key)]),
    );
    const validations = (
      await tx.query('SELECT payload FROM validations WHERE org_id=$1 AND run_id=$2', [
        run.org_id,
        run.run_id,
      ])
    ).map((row) => ArtifactValidationSchema.safeParse(json(row)));
    if (
      artifacts.some(
        (artifact) =>
          !validations.some(
            (validation) =>
              validation.success &&
              validation.data.artifact_id === artifact.artifact_id &&
              validation.data.org_id === run.org_id &&
              validation.data.run_id === run.run_id &&
              validation.data.valid === true,
          ),
      )
    )
      fail('PUBLICATION_VALIDATION_REQUIRED', 422);
    const draft = artifacts.find((artifact) => artifact.artifact_id === input.draft_artifact_id);
    const review = artifacts.find((artifact) => artifact.artifact_id === input.review_artifact_id);
    if (draft?.kind !== 'report_draft' || review?.kind !== 'review_result')
      fail('PUBLICATION_DRAFT_REVIEW_REQUIRED', 422);
    const sourceIds = new Set(artifacts.flatMap((artifact) => artifact.source_refs));
    const imports = await tx.query('SELECT id FROM imports WHERE org_id=$1', [run.org_id]);
    const importIds = new Set(imports.map((row) => String(row.id)));
    if ([...sourceIds].some((sourceId) => !importIds.has(sourceId)))
      fail('MISSING_IMPORT_MANIFEST', 422);
    if (report.task_id !== publicationTask.task_id) fail('INVALID_PUBLICATION_TASK', 422);
    try {
      validateAgentPublication(
        draft as ArtifactOf<'report_draft'>,
        review as ArtifactOf<'review_result'>,
        report as ArtifactOf<'report'>,
        artifacts,
        run,
        artifactKeys,
      );
    } catch (error) {
      if (error instanceof Error && /^[A-Z_]{1,80}$/.test(error.message)) fail(error.message, 422);
      throw error;
    }

    await tx.query(
      'INSERT INTO artifacts(org_id,id,run_id,task_id,kind,artifact_key,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        report.org_id,
        report.artifact_id,
        report.run_id,
        report.task_id,
        report.kind,
        'report',
        JSON.stringify(report),
      ],
    );
    await insertBatches(
      tx,
      'INSERT INTO artifact_inputs(org_id,run_id,artifact_id,input_id)',
      report.input_refs.map((artifactId) => [
        run.org_id,
        run.run_id,
        report.artifact_id,
        artifactId,
      ]),
    );
    await insertBatches(
      tx,
      'INSERT INTO artifact_snapshots(org_id,run_id,artifact_id,snapshot_id)',
      report.snapshot_refs.map((snapshotId) => [
        run.org_id,
        run.run_id,
        report.artifact_id,
        snapshotId,
      ]),
    );
    await insertBatches(
      tx,
      'INSERT INTO artifact_sources(org_id,artifact_id,import_id)',
      report.source_refs.map((sourceId) => [run.org_id, report.artifact_id, sourceId]),
    );
    const validation: ArtifactValidation = {
      artifact_id: report.artifact_id,
      org_id: run.org_id,
      run_id: run.run_id,
      validated_at: now(),
      validator_version: 'mvp-validator-v1',
      valid: true,
      checks: ['schema', 'hash', 'tenant', 'lineage', 'review-pass', 'publication-gate'],
    };
    await tx.query('INSERT INTO validations(org_id,id,run_id,payload) VALUES($1,$2,$3,$4)', [
      run.org_id,
      validation.artifact_id,
      run.run_id,
      JSON.stringify(validation),
    ]);
    const completedTask: RunTask = {
      ...persistedTask.data,
      status: 'succeeded',
      error_code: null,
    };
    await tx.query('UPDATE tasks SET payload=$4 WHERE org_id=$1 AND run_id=$2 AND id=$3', [
      run.org_id,
      run.run_id,
      completedTask.task_id,
      JSON.stringify(completedTask),
    ]);
    await syncAgentInvocationsFromRun(tx, run.org_id, run.run_id);
    const publicationEvent: RunEvent = {
      event_id: randomUUID(),
      run_id: run.run_id,
      org_id: run.org_id,
      created_at: now(),
      task_id: completedTask.task_id,
      message: 'publication: succeeded',
    };
    await tx.query('INSERT INTO events(org_id,id,run_id,payload) VALUES($1,$2,$3,$4)', [
      run.org_id,
      publicationEvent.event_id,
      run.run_id,
      JSON.stringify(publicationEvent),
    ]);
    run.status = 'succeeded';
    run.report_artifact_id = report.artifact_id;
    run.lease_until = null;
    await updateRun(tx, run);
    const record: ReportRecord = {
      report_id: randomUUID(),
      org_id: run.org_id,
      run_id: run.run_id,
      artifact_id: report.artifact_id,
      created_at: now(),
      occurrence_id: run.occurrence_id,
    };
    await tx.query(
      'INSERT INTO reports(org_id,id,run_id,artifact_id,payload) VALUES($1,$2,$3,$4,$5)',
      [run.org_id, record.report_id, run.run_id, report.artifact_id, JSON.stringify(record)],
    );
    // Draft and review records are intentionally owner/analyst-only. The
    // shared completion message carries public artifact references only;
    // authorized clients hydrate private workflow records separately.
    const referencedArtifacts = [...artifacts, report].filter(
      (artifact) => artifact.kind !== 'report_draft' && artifact.kind !== 'review_result',
    );
    await finishRunAssistant(tx, run, {
      status: 'completed',
      content:
        'PhÃ¢n tÃ­ch Ä‘Ã£ hoÃ n thÃ nh. Má»Ÿ Decision Briefing Ä‘á»ƒ xem cÃ¡c tÃ­n hiá»‡u vÃ  báº±ng chá»©ng Ä‘Ã£ xÃ¡c thá»±c.',
      parts: [
        {
          type: 'text',
          text: 'PhÃ¢n tÃ­ch Ä‘Ã£ hoÃ n thÃ nh. Má»Ÿ Decision Briefing Ä‘á»ƒ xem cÃ¡c tÃ­n hiá»‡u vÃ  báº±ng chá»©ng Ä‘Ã£ xÃ¡c thá»±c.',
        },
        { type: 'run_ref', run_id: run.run_id, status: 'succeeded' },
        { type: 'report_ref', run_id: run.run_id, report_id: record.report_id },
        ...referencedArtifacts.map((artifact) => ({
          type: 'artifact_ref' as const,
          run_id: run.run_id,
          artifact_id: artifact.artifact_id,
          kind: artifact.kind,
        })),
      ],
    });
    return record;
  });
}

import { randomUUID } from 'node:crypto';
import { type Artifact, type ArtifactValidation, type ReportRecord } from '@vda/contracts';
import { validateReport } from '@vda/domain';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { json } from '../mapping/rows';
import { updateRun } from '../repositories/run-repository';
import { finishRunAssistant } from '../workflow/checkpoint-repository';
import { fenceRun } from '../workflow/lease-repository';
import type { Lease } from '../types';

const now = () => new Date().toISOString();

export async function publishLegacyReport(db: Driver, lease: Lease, id: string) {
  await db.transaction(async (tx) => {
    const run = await fenceRun(tx, lease);
    if (run.workflow_version === 'agent-v1') fail('AGENT_PUBLICATION_REQUIRED', 409);
    const rows = await tx.query(
      'SELECT a.payload,v.payload AS validation FROM artifacts a JOIN validations v ON v.org_id=a.org_id AND v.id=a.id WHERE a.org_id=$1 AND a.run_id=$2 AND a.id=$3 AND a.kind=$4',
      [run.org_id, run.run_id, id, 'report'],
    );
    if (
      !rows[0] ||
      !(
        typeof rows[0].validation === 'string' ? JSON.parse(rows[0].validation) : rows[0].validation
      ).valid
    )
      fail('PUBLICATION_VALIDATION_REQUIRED', 422);
    const artifact = json(rows[0]) as Artifact;
    if (artifact.kind !== 'report') fail('INVALID_REPORT', 422);
    const allArtifacts = (
      await tx.query('SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2', [
        run.org_id,
        run.run_id,
      ])
    ).map(json) as Artifact[];
    const allValidations = (
      await tx.query('SELECT payload FROM validations WHERE org_id=$1 AND run_id=$2', [
        run.org_id,
        run.run_id,
      ])
    ).map(json) as ArtifactValidation[];
    if (
      allArtifacts.some(
        (a) => !allValidations.some((v) => v.artifact_id === a.artifact_id && v.valid),
      )
    )
      fail('PUBLICATION_VALIDATION_REQUIRED', 422);
    validateReport(artifact.payload, allArtifacts, run.org_id, run.run_id);
    run.status = 'succeeded';
    run.report_artifact_id = id;
    run.lease_until = null;
    await updateRun(tx, run);
    const report: ReportRecord = {
      report_id: randomUUID(),
      org_id: run.org_id,
      run_id: run.run_id,
      artifact_id: id,
      created_at: now(),
      occurrence_id: run.occurrence_id,
    };
    await tx.query(
      'INSERT INTO reports(org_id,id,run_id,artifact_id,payload) VALUES($1,$2,$3,$4,$5)',
      [run.org_id, report.report_id, run.run_id, id, JSON.stringify(report)],
    );
    await finishRunAssistant(tx, run, {
      status: 'completed',
      content:
        'Phân tích đã hoàn thành. Mở Decision Briefing để xem các tín hiệu và bằng chứng đã xác thực.',
      parts: [
        {
          type: 'text',
          text: 'Phân tích đã hoàn thành. Mở Decision Briefing để xem các tín hiệu và bằng chứng đã xác thực.',
        },
        { type: 'run_ref', run_id: run.run_id, status: 'succeeded' },
        { type: 'report_ref', run_id: run.run_id, report_id: report.report_id },
        ...allArtifacts.map((item) => ({
          type: 'artifact_ref' as const,
          run_id: run.run_id,
          artifact_id: item.artifact_id,
          kind: item.kind,
        })),
      ],
    });
  });
}

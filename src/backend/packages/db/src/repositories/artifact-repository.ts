import {
  ArtifactSchema,
  ArtifactValidationSchema,
  type Artifact,
  type ArtifactValidation,
  type DecisionBriefResponse,
  type DecisionIntelligenceResponse,
  type ImportManifest,
} from '@vda/contracts';
import { validateDecisionBrief, verifyArtifact } from '@vda/domain';
import { authorizeInTransaction } from '../authorization/authorization-repository';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { json } from '../mapping/rows';
import { readRun } from './run-repository';
import { normalizeArtifactKey } from '../types';

export async function artifacts(db: Driver, user: string, org: string, id: string) {
  return db.transaction(async (tx) => {
    const role = await authorizeInTransaction(tx, user, org);
    await readRun(tx, org, id);
    const allArtifacts = (
      await tx.query('SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2', [org, id])
    ).map(json) as Artifact[];
    const artifacts =
      role === 'viewer'
        ? allArtifacts.filter(
            (artifact) => artifact.kind !== 'report_draft' && artifact.kind !== 'review_result',
          )
        : allArtifacts;
    const visibleArtifactIds = new Set(artifacts.map((artifact) => artifact.artifact_id));
    const validations = (
      await tx.query('SELECT payload FROM validations WHERE org_id=$1 AND run_id=$2', [org, id])
    ).map(json) as ArtifactValidation[];
    const sourceIds = new Set(artifacts.flatMap((a) => a.source_refs));
    const sources = (
      (await tx.query('SELECT payload FROM imports WHERE org_id=$1', [org])).map(
        json,
      ) as ImportManifest[]
    ).filter((x) => sourceIds.has(x.import_id));
    return {
      artifacts,
      validations: validations.filter((validation) =>
        visibleArtifactIds.has(validation.artifact_id),
      ),
      sources,
    };
  });
}

export async function artifactByKey(
  db: Driver,
  user: string,
  org: string,
  runId: string,
  key: string,
): Promise<Artifact> {
  let artifactKey: string;
  try {
    artifactKey = normalizeArtifactKey(key);
  } catch {
    fail('INVALID_ARTIFACT_KEY');
  }
  return db.transaction(async (tx) => {
    const role = await authorizeInTransaction(tx, user, org);
    await readRun(tx, org, runId);
    const rows = await tx.query(
      'SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2 AND artifact_key=$3',
      [org, runId, artifactKey],
    );
    if (!rows[0]) fail('ARTIFACT_NOT_FOUND', 404);
    const artifact = ArtifactSchema.parse(json(rows[0]));
    if (
      role === 'viewer' &&
      (artifact.kind === 'report_draft' || artifact.kind === 'review_result')
    )
      fail('ARTIFACT_NOT_FOUND', 404);
    verifyArtifact(artifact);
    return artifact;
  });
}

export async function publicArtifactById(
  db: Driver,
  user: string,
  org: string,
  runId: string,
  artifactId: string,
): Promise<Artifact> {
  return db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org);
    await readRun(tx, org, runId);
    const rows = await tx.query(
      'SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2 AND id=$3',
      [org, runId, artifactId],
    );
    if (!rows[0]) fail('ARTIFACT_NOT_FOUND', 404);
    const artifact = ArtifactSchema.parse(json(rows[0]));
    verifyArtifact(artifact);
    if (artifact.org_id !== org || artifact.run_id !== runId || artifact.artifact_id !== artifactId)
      fail('ARTIFACT_NOT_FOUND', 404);
    // Draft and reviewer artifacts are never conversational context, even
    // when the caller has a role that can inspect the workflow internally.
    if (artifact.kind === 'report_draft' || artifact.kind === 'review_result')
      fail('ARTIFACT_NOT_FOUND', 404);
    const validations = (
      await tx.query('SELECT payload FROM validations WHERE org_id=$1 AND run_id=$2 AND id=$3', [
        org,
        runId,
        artifact.artifact_id,
      ])
    ).flatMap((row) => {
      const parsed = ArtifactValidationSchema.safeParse(json(row));
      return parsed.success ? [parsed.data] : [];
    });
    if (
      !validations.some(
        (validation) =>
          validation.valid &&
          validation.artifact_id === artifact.artifact_id &&
          validation.org_id === org &&
          validation.run_id === runId,
      )
    )
      fail('PUBLIC_ARTIFACT_VALIDATION_REQUIRED', 409);
    return artifact;
  });
}

export async function publicArtifactsByIds(
  db: Driver,
  user: string,
  org: string,
  runId: string,
  artifactIds: readonly string[],
): Promise<Artifact[]> {
  const ids = [...new Set(artifactIds)].slice(0, 100);
  if (!ids.length) return [];
  return db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org);
    await readRun(tx, org, runId);
    const rows = await tx.query(
      'SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2 AND id = ANY($3::text[])',
      [org, runId, ids],
    );
    const candidates = rows.flatMap((row) => {
      const parsed = ArtifactSchema.safeParse(json(row));
      if (!parsed.success) return [];
      const artifact = parsed.data;
      try {
        verifyArtifact(artifact);
      } catch {
        return [];
      }
      if (
        artifact.org_id !== org ||
        artifact.run_id !== runId ||
        !ids.includes(artifact.artifact_id) ||
        artifact.kind === 'report_draft' ||
        artifact.kind === 'review_result'
      )
        return [];
      return [artifact];
    });
    if (!candidates.length) return [];
    const validations = (
      await tx.query(
        'SELECT payload FROM validations WHERE org_id=$1 AND run_id=$2 AND id = ANY($3::text[])',
        [org, runId, candidates.map((artifact) => artifact.artifact_id)],
      )
    ).flatMap((row) => {
      const parsed = ArtifactValidationSchema.safeParse(json(row));
      return parsed.success ? [parsed.data] : [];
    });
    const validIds = new Set(
      validations
        .filter(
          (validation) =>
            validation.valid &&
            validation.org_id === org &&
            validation.run_id === runId &&
            candidates.some((artifact) => artifact.artifact_id === validation.artifact_id),
        )
        .map((validation) => validation.artifact_id),
    );
    return candidates.filter((artifact) => validIds.has(artifact.artifact_id));
  });
}

export async function decisionBrief(
  db: Driver,
  user: string,
  org: string,
  id: string,
): Promise<DecisionBriefResponse> {
  return db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org);
    const run = await readRun(tx, org, id);
    if (run.status !== 'succeeded' || run.report_artifact_id === null)
      fail('BRIEF_NOT_AVAILABLE', 404);
    const reportRows = await tx.query(
      "SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2 AND id=$3 AND kind='report'",
      [org, id, run.report_artifact_id],
    );
    if (!reportRows[0]) fail('BRIEF_NOT_AVAILABLE', 404);
    const report = ArtifactSchema.parse(json(reportRows[0]));
    if (report.kind !== 'report' || report.payload.decision_brief === undefined)
      fail('BRIEF_NOT_AVAILABLE', 404);
    const calculationRows = await tx.query(
      "SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2 AND id=$3 AND kind='calculation'",
      [org, id, report.payload.calculation_artifact_id],
    );
    if (!calculationRows[0]) fail('INVALID_BRIEF_LINEAGE', 409);
    const calculation = ArtifactSchema.parse(json(calculationRows[0]));
    if (calculation.kind !== 'calculation') fail('INVALID_BRIEF_LINEAGE', 409);
    const validations = (
      await tx.query(
        'SELECT payload FROM validations WHERE org_id=$1 AND run_id=$2 AND (id=$3 OR id=$4)',
        [org, id, report.artifact_id, calculation.artifact_id],
      )
    ).map(json) as ArtifactValidation[];
    if (
      ![report.artifact_id, calculation.artifact_id].every((artifactId) =>
        validations.some((validation) => validation.artifact_id === artifactId && validation.valid),
      )
    )
      fail('UNVALIDATED_BRIEF', 409);
    verifyArtifact(report);
    verifyArtifact(calculation);
    validateDecisionBrief(
      report.payload.decision_brief,
      calculation,
      org,
      id,
      run.request.scope,
      run.request.data_as_of,
    );
    return {
      run_id: run.run_id,
      org_id: run.org_id,
      scope: run.request.scope,
      requested_data_as_of: run.request.data_as_of,
      effective_snapshot_date: report.payload.decision_brief.effective_snapshot_date,
      decision_brief: report.payload.decision_brief,
      report_artifact_id: report.artifact_id,
      calculation_artifact_id: calculation.artifact_id,
      evidence_artifact_ids: [calculation.artifact_id],
      validations,
    };
  });
}

export async function decisionIntelligence(
  db: Driver,
  user: string,
  org: string,
  id: string,
): Promise<DecisionIntelligenceResponse> {
  return db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org);
    const run = await readRun(tx, org, id);
    // Decision reads are scoped to the already-authorized run.
    if (run.status !== 'succeeded' || run.report_artifact_id === null)
      return {
        status: 'unavailable',
        run_id: run.run_id,
        org_id: run.org_id,
        reason: 'RUN_NOT_SUCCEEDED',
      };
    const placeholder = '$';
    const reportRows = await tx.query(
      `SELECT payload FROM artifacts WHERE org_id=${placeholder}1 AND run_id=${placeholder}2 AND id=${placeholder}3 AND kind='report'`,
      [org, id, run.report_artifact_id],
    );
    if (!reportRows[0])
      return {
        status: 'unavailable',
        run_id: run.run_id,
        org_id: run.org_id,
        reason: 'DECISION_ARTIFACT_NOT_AVAILABLE',
      };
    const report = ArtifactSchema.parse(json(reportRows[0]));
    if (report.kind !== 'report') fail('INVALID_DECISION_REPORT_LINEAGE', 409);
    verifyArtifact(report);
    const decisionId = report.payload.decision_intelligence_artifact_id;
    if (!decisionId) {
      if (report.payload.decision_brief === undefined)
        return {
          status: 'unavailable',
          run_id: run.run_id,
          org_id: run.org_id,
          reason: 'DECISION_ARTIFACT_NOT_AVAILABLE',
        };
      return {
        status: 'legacy_report_brief',
        run_id: run.run_id,
        org_id: run.org_id,
        decision_brief: report.payload.decision_brief,
        report_artifact_id: report.artifact_id,
      };
    }
    const decisionRows = await tx.query(
      `SELECT payload FROM artifacts WHERE org_id=${placeholder}1 AND run_id=${placeholder}2 AND id=${placeholder}3 AND kind='decision_intelligence_pack'`,
      [org, id, decisionId],
    );
    if (!decisionRows[0]) fail('INVALID_DECISION_PACK_LINEAGE', 409);
    const decision = ArtifactSchema.parse(json(decisionRows[0]));
    if (
      decision.kind !== 'decision_intelligence_pack' ||
      decision.org_id !== org ||
      decision.run_id !== id ||
      decision.payload.run_id !== id ||
      decision.payload.org_id !== org ||
      decision.payload.requested_data_as_of !== run.request.data_as_of ||
      JSON.stringify(decision.payload.scope) !== JSON.stringify(run.request.scope) ||
      !report.input_refs.includes(decision.artifact_id)
    )
      fail('INVALID_DECISION_PACK_LINEAGE', 409);
    verifyArtifact(decision);
    const validations = (
      await tx.query(
        `SELECT payload FROM validations WHERE org_id=${placeholder}1 AND run_id=${placeholder}2 AND (id=${placeholder}3 OR id=${placeholder}4)`,
        [org, id, report.artifact_id, decision.artifact_id],
      )
    ).map(json) as ArtifactValidation[];
    if (
      ![report.artifact_id, decision.artifact_id].every((artifactId) =>
        validations.some((validation) => validation.artifact_id === artifactId && validation.valid),
      )
    )
      fail('UNVALIDATED_DECISION_INTELLIGENCE', 409);
    return {
      status: 'available',
      run_id: run.run_id,
      org_id: run.org_id,
      report_artifact_id: report.artifact_id,
      decision_intelligence_artifact_id: decision.artifact_id,
      decision_intelligence: decision.payload,
      validations,
    };
  });
}

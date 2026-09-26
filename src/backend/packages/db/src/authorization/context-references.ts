import { ArtifactSchema, ArtifactValidationSchema, MessageContextRefSchema, type MessageContextRef } from '@vda/contracts';
import { verifyArtifact } from '@vda/domain';
import type { Driver, Row } from '../driver';
import { fail } from '../errors';
import { json } from '../mapping/rows';

export type ResolvedContextReference = MessageContextRef & { run_id: string | null; artifact_id: string | null };

/** Call inside an authorized transaction; explicit references never grant access. */
export async function resolveContextReference(tx: Driver, org: string, value: MessageContextRef): Promise<ResolvedContextReference> {
  const ref = MessageContextRefSchema.parse(value);
  let rows: Row[];
  if (ref.type === 'report') {
    rows = await tx.query('SELECT run_id,artifact_id FROM reports WHERE org_id=$1 AND id=$2', [org, ref.id]);
  } else if (ref.type === 'artifact') {
    // Private workflow drafts never enter public chat context, even for an owner.
    rows = await tx.query("SELECT run_id,id AS artifact_id FROM artifacts WHERE org_id=$1 AND id=$2 AND kind NOT IN ('report_draft','review_result')", [org, ref.id]);
  } else {
    rows = await tx.query('SELECT id FROM imports WHERE org_id=$1 AND id=$2', [org, ref.id]);
  }
  if (!rows[0]) fail('CONTEXT_REFERENCE_NOT_FOUND', 404);
  if (ref.type === 'artifact' || ref.type === 'report') {
    const artifactId = String(rows[0].artifact_id);
    const runId = String(rows[0].run_id);
    const stored = await tx.query('SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2 AND id=$3',[org,runId,artifactId]);
    const parsed = ArtifactSchema.safeParse(stored[0] ? json(stored[0]) : null);
    if (!parsed.success || parsed.data.org_id !== org || parsed.data.run_id !== runId || parsed.data.artifact_id !== artifactId ||
        ['report_draft','review_result'].includes(parsed.data.kind) || (ref.type === 'report' && parsed.data.kind !== 'report')) fail('CONTEXT_REFERENCE_NOT_FOUND',404);
    try { verifyArtifact(parsed.data); } catch { fail('CONTEXT_REFERENCE_NOT_FOUND',404); }
    const validations = await tx.query('SELECT payload FROM validations WHERE org_id=$1 AND run_id=$2 AND id=$3',[org,runId,artifactId]);
    if (!validations.some(row => {
      const checked = ArtifactValidationSchema.safeParse(json(row));
      return checked.success && checked.data.valid && checked.data.org_id === org && checked.data.run_id === runId && checked.data.artifact_id === artifactId;
    })) fail('CONTEXT_REFERENCE_NOT_FOUND',404);
  }
  return { ...ref, run_id: rows[0].run_id ? String(rows[0].run_id) : null, artifact_id: rows[0].artifact_id ? String(rows[0].artifact_id) : null };
}

export async function validateMessageContext(tx: Driver, org: string, conversationId: string, refs: MessageContextRef[] = [], replyId?: string | null) {
  for (const ref of refs) await resolveContextReference(tx, org, ref);
  if (replyId && !(await tx.query('SELECT id FROM messages WHERE org_id=$1 AND conversation_id=$2 AND id=$3', [org, conversationId, replyId]))[0])
    fail('REPLY_MESSAGE_NOT_FOUND', 404);
}


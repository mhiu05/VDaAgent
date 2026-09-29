import { z } from 'zod';
import {
  AcceptedSchema,
  ArtifactListSchema,
  DecisionBriefResponseSchema,
  DecisionIntelligenceResponseSchema,
  MessageSchema,
  RunDetailSchema,
} from '@vda/contracts';
import { api, post, scoped } from '../../../lib/http/api-client';

export function getRunDetail(orgId: string, runId: string) {
  return api(scoped(`/runs/${runId}`, orgId), RunDetailSchema);
}

export function getRunMessages(orgId: string, conversationId: string) {
  return api(
    scoped(`/messages?conversation_id=${encodeURIComponent(conversationId)}`, orgId),
    z.object({ messages: z.array(MessageSchema) }),
  );
}

export function getRunDecision(orgId: string, runId: string) {
  return api(
    scoped(`/runs/${runId}/decision-intelligence`, orgId),
    DecisionIntelligenceResponseSchema,
  );
}

export function getRunBrief(orgId: string, runId: string) {
  return api(scoped(`/runs/${runId}/brief`, orgId), DecisionBriefResponseSchema);
}

export function getRunArtifacts(orgId: string, runId: string) {
  return api(scoped(`/runs/${runId}/artifacts`, orgId), ArtifactListSchema);
}

export function createAnalysis(
  orgId: string,
  project: string,
  zone: string,
  dataAsOf: string,
  question: string,
  conversationId: string | null,
) {
  return api('/analyses', AcceptedSchema, {
    ...post({
      org_id: orgId,
      scope: { project_external_id: project, zone_external_id: zone || null },
      data_as_of: dataAsOf,
      question,
      conversation_id: conversationId,
    }),
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
}

export function cancelAnalysisRun(orgId: string, runId: string) {
  return api(scoped(`/runs/${runId}/cancel`, orgId), z.unknown(), post({ org_id: orgId }));
}

export function cancelAcknowledgedRun(orgId: string, runId: string) {
  return api(
    scoped(`/runs/${runId}/cancel`, orgId),
    z.object({ ok: z.literal(true) }),
    post({ org_id: orgId }),
  );
}

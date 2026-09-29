import { AgentWorkflowStatusSchema } from '@vda/contracts';
import { api, scoped } from '../../../lib/http/api-client';

export function getAgentWorkflowStatus(orgId: string, runId: string) {
  return api(scoped(`/runs/${runId}/workflow-status`, orgId), AgentWorkflowStatusSchema);
}

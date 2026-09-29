import { describe, expect, it, vi } from 'vitest';
import { RepositoryError, type Repository } from '@vda/db';
import { workflowStatus } from '../../src/frontend/server/api/queries/workflow-status';
import { authenticatedContext } from '../../src/frontend/server/api/middleware/authenticated-context';

const orgId = '10000000-0000-4000-8000-000000000001';
const otherOrg = '10000000-0000-4000-8000-000000000002';
const userId = '20000000-0000-4000-8000-000000000001';
const runId = '30000000-0000-4000-8000-000000000001';

describe('API authorization before private reads', () => {
  it('checks mutation membership before loading workflow draft state', async () => {
    const authorize = vi.fn(async () => 'owner' as const);
    const getRun = vi.fn(async () => ({
      run: { run_id: runId, org_id: orgId, workflow_version: 'agent-v1' },
      tasks: [],
    }));
    const artifacts = vi.fn(async () => ({ artifacts: [] }));
    const repo = { authorize, getRun, artifacts } as unknown as Repository;
    expect(await workflowStatus(repo, userId, orgId, runId)).toMatchObject({
      run_id: runId,
      org_id: orgId,
      draft_revision: null,
      review: null,
    });
    expect(authorize).toHaveBeenCalledWith(userId, orgId, true);
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(getRun.mock.invocationCallOrder[0]);
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
      artifacts.mock.invocationCallOrder[0],
    );
  });

  it('returns only review issue categories from the private artifact', async () => {
    const repo = {
      authorize: vi.fn(async () => 'owner' as const),
      getRun: vi.fn(async () => ({
        run: { run_id: runId, org_id: orgId, workflow_version: 'agent-v1' },
        tasks: [],
      })),
      artifacts: vi.fn(async () => ({ artifacts: [
        { kind: 'report_draft', artifact_id: 'draft', payload: { revision: 1 } },
        { kind: 'review_result', payload: {
          draft_artifact_id: 'draft', draft_revision: 1, status: 'REVISION_REQUIRED',
          issues: [{ category: 'metric_mismatch', message: 'private details' }],
        } },
      ] })),
    } as unknown as Repository;
    const status = await workflowStatus(repo, userId, orgId, runId);
    expect(status.review).toEqual({
      draft_revision: 1,
      status: 'REVISION_REQUIRED',
      issues: ['metric_mismatch'],
    });
    expect(JSON.stringify(status)).not.toContain('private details');
  });

  it('never reads private workflow state after membership fails', async () => {
    const getRun = vi.fn();
    const artifacts = vi.fn();
    const repo = {
      authorize: vi.fn(async () => {
        throw new RepositoryError('FORBIDDEN', 403);
      }),
      getRun,
      artifacts,
    } as unknown as Repository;
    await expect(workflowStatus(repo, userId, orgId, runId)).rejects.toThrow('FORBIDDEN');
    expect(getRun).not.toHaveBeenCalled();
    expect(artifacts).not.toHaveBeenCalled();
  });

  it('rejects a chat body that asks for another organization', async () => {
    const url = new URL(`http://localhost/api/conversations?org_id=${orgId}`);
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        org_id: otherOrg,
        client_turn_id: crypto.randomUUID(),
        text: 'Inspect inventory',
        scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
        data_as_of: '2026-09-19',
      }),
    });
    const context = authenticatedContext(
      request,
      ['conversations'],
      'POST',
      url,
      'conversations',
      { user_id: userId, email: 'owner@example.test' },
      {} as Repository,
    );
    await expect(context.agentTurnFromBody()).rejects.toThrow('NO_AUTHORIZED_RESULT');
  });
});

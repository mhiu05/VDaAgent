import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { AgentTurnRequestSchema, ThreadContextSchema, type Artifact } from '../../packages/contracts/src/index';
import { executeAgentWorkflow, executeSpecialistWorkflow } from '@vda/agents/analysis-v1/workflow';
import { SAFE_SUMMARY, validateReport, verifyArtifact } from '../../packages/domain/src/index';
import { FallbackNarrativeProvider, GeminiProvider } from '../../packages/agents/src/legacy-workflow/narrative/provider';
import { createWireTestRepository } from '../../tests/helpers/postgres-wire';
import { dispatchAgentTurn } from './agent-turn-dispatcher';
import { dispatchWorkflow } from './workflow-dispatcher';
import { runLoop } from './run-loop';
import { conversationRoutes } from '../../../frontend/src/server/api/routes/conversations';
import { runtimeWorkspaceRoutes } from '../../../frontend/src/server/api/routes/runtime-workspace';
import type { AuthenticatedRouteContext } from '../../../frontend/src/server/api/routes/route-context';
import { readSse, type SseFrame } from '../../../frontend/src/lib/sse';
import { deliverAgentTurn } from '../../../frontend/src/features/agent-chat/api/turn-delivery';
import { projectQueryUsage } from '../../../frontend/src/features/evidence/query-usage';

vi.mock('@vda/config', () => ({ getConfig: () => ({
  GROK_RUNTIME_ENABLED: true, GROK_SSE_ENABLED: true, DURABLE_AGENT_EXECUTION_ENABLED: true,
}) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const input = {
  org_id: TEST_ORGS.alpha, client_turn_id: '70000000-0000-4000-8000-000000000081',
  text: 'Analyze inventory', scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
};

function context(repo: Repository, request: Request): AuthenticatedRouteContext {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/v1/', '').split('/');
  return { repo, request, url, path, route: path.join('/'), method: request.method,
    actor: { user_id: TEST_USERS.owner, email: 'owner@example.test' },
    orgFromQuery: () => url.searchParams.get('org_id') ?? TEST_ORGS.alpha,
    agentTurnFromBody: async () => AgentTurnRequestSchema.parse(await request.json()),
    pageFromQuery: () => ({ limit: 30, cursor: null }),
  };
}
const streamRequest = (path: string, after = 0) => new Request(`http://localhost/api/v1/${path}?org_id=${TEST_ORGS.alpha}&after=0`, {
  headers: { accept: 'text/event-stream', 'Last-Event-ID': String(after) },
});

describe('durable analysis over postgres.js wire protocol', () => {
  it.each([null, 'data'] as const)('delivers %s through API, worker, checkpoints and both browser SSE readers', async target => {
    const { repo, driver, close } = await createWireTestRepository();
    try {
      const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const request = new Request(new URL(String(url), 'http://localhost'), init);
        // No outbound provider calls are permitted by this fixture.
        if (new URL(request.url).hostname !== 'localhost') throw new Error('REAL_PROVIDER_FORBIDDEN');
        try { return (await conversationRoutes(context(repo, request)))!; }
        catch (error) { if (error && typeof error === 'object' && 'status' in error) return Response.json({}, { status: Number(error.status) }); throw error; }
      });
      vi.stubGlobal('fetch', fetch);
      const identity = { client_turn_id: input.client_turn_id, idempotency_key: 'wire-turn' };
      const accepted = await deliverAgentTurn(TEST_ORGS.alpha, { ...input, agent_target: target }, identity, undefined, true, vi.fn());
      expect(accepted.assistant_status).toBe('in_progress');
      expect(accepted.run_id).toBeNull();
      const duplicate = await deliverAgentTurn(TEST_ORGS.alpha, { ...input, agent_target: target }, identity, undefined, false, vi.fn());
      expect(duplicate).toEqual(accepted);
      expect(await driver.query('SELECT count(*)::int AS total FROM agent_turn_jobs')).toEqual([{ total: 1 }]);
      const jobId = accepted.agent_turn_job_id!;
      const jobFrames: SseFrame[] = [];
      const jobResponse = (await conversationRoutes(context(repo, streamRequest(`agent-turn-jobs/${jobId}/events`))))!;
      const jobRead = readSse(jobResponse, frame => jobFrames.push(frame), 2_000_000);
      const errors = vi.fn();
      const tick = () => runLoop(repo, 'wire-worker', () => false, true, {
        durableAgentExecution: true,
        dispatchAgent: (repository, lease) => dispatchAgentTurn(repository, lease, { log: vi.fn(), error: errors }),
        dispatch: (repository, lease) => dispatchWorkflow(repository, lease, {
          log: vi.fn(), error: errors,
          agentWorkflow: (repository, lease, options) => {
            expect(lease.run.status).toBe('running');
            return (target ? executeSpecialistWorkflow : executeAgentWorkflow)(repository, lease, { ...options,
              narrativeProvider: { narrate: async claims => ({ summary: SAFE_SUMMARY, claims, provider: 'gemini' }) },
            });
          },
        }),
      });
      await tick();
      const waiting = await repo.getAgentTurnJob(TEST_USERS.owner, TEST_ORGS.alpha, jobId);
      expect(waiting.job.status).toBe('waiting');
      const runId = waiting.job.run_id!;
      expect((await repo.getRun(TEST_USERS.owner, TEST_ORGS.alpha, runId)).run.status).toBe('queued');
      const runFrames: SseFrame[] = [];
      const runResponse = (await runtimeWorkspaceRoutes(context(repo, streamRequest(`runs/${runId}/events`))))!;
      const runRead = readSse(runResponse, frame => runFrames.push(frame), 2_000_000);
      await tick();
      await tick();
      await Promise.all([jobRead, runRead]);
      expect(errors).not.toHaveBeenCalled();
      expect((await repo.getAgentTurnJob(TEST_USERS.owner, TEST_ORGS.alpha, jobId)).job.status).toBe('completed');
      const runtime = await repo.getRunRuntime(TEST_USERS.owner, TEST_ORGS.alpha, runId);
      expect(runtime.records.some(record => record.kind === 'tool' && record.status === 'completed')).toBe(true);
      const progress = runFrames.filter(frame => frame.event === 'runtime').map(frame => JSON.parse(frame.data));
      expect(progress.some(event => event.record.kind === 'invocation' && event.record.status === 'running')).toBe(true);
      expect(progress.some(event => event.record.status === 'waiting')).toBe(!target);
      expect(progress.some(event => event.record.kind === 'tool' && event.record.status === 'completed')).toBe(true);
      expect(JSON.parse(runFrames.at(-1)!.data).status).toBe('succeeded');
      expect(JSON.parse(jobFrames.at(-1)!.data).status).toBe('completed');
      const reply = await repo.getMessage(TEST_USERS.owner, TEST_ORGS.alpha, accepted.conversation_id, accepted.assistant_message_id);
      expect(reply.status).toBe('completed');
      expect(reply.parts.some(part => part.type === (target ? 'artifact_ref' : 'report_ref'))).toBe(true);
      const cursor = progress[Math.floor(progress.length / 2)].sequence;
      const replay = (await runtimeWorkspaceRoutes(context(repo, streamRequest(`runs/${runId}/events`, cursor))))!;
      const replayed: SseFrame[] = [];
      await readSse(replay, frame => replayed.push(frame), 2_000_000);
      expect(replayed.filter(frame => frame.id).map(frame => Number(frame.id))).toEqual(progress.filter(event => event.sequence > cursor).map(event => event.sequence));
      expect(replayed.at(-1)?.event).toBe('terminal');
      expect(await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).toHaveLength(1);
      await expect(repo.getRunRuntime(TEST_USERS.beta, TEST_ORGS.alpha, runId)).rejects.toThrow();
      const thread = await repo.getThreadContext(TEST_USERS.owner, TEST_ORGS.alpha, accepted.conversation_id);
      await repo.updateThreadContext(TEST_USERS.owner, TEST_ORGS.alpha, accepted.conversation_id, ThreadContextSchema.parse(thread));
      for (const summary of ['Initial verified context', 'Updated verified context']) {
        await repo.saveMemory(TEST_USERS.owner, TEST_ORGS.alpha, { layer: 'working', run_id: runId,
          conversation_id: accepted.conversation_id, key: 'wire-upsert', summary, artifact_refs: [] });
      }
      for (const table of ['runs', 'tasks', 'events', 'artifacts', 'validations', 'messages', 'runtime_activities', 'runtime_activity_events'])
        expect(await driver.query(`SELECT DISTINCT jsonb_typeof(payload) AS type FROM ${table}`)).toEqual([{ type: 'object' }]);
      expect(await driver.query('SELECT DISTINCT jsonb_typeof(data) AS type FROM agent_execution_events')).toEqual([{ type: 'object' }]);
      expect(await driver.query('SELECT DISTINCT jsonb_typeof(artifact_refs) AS type FROM agent_memory')).toEqual([{ type: 'array' }]);
      expect(await driver.query('SELECT DISTINCT jsonb_typeof(context) AS type FROM conversations')).toEqual([{ type: 'object' }]);
      if (!target) expect(await driver.query('SELECT DISTINCT jsonb_typeof(payload) AS type FROM reports')).toEqual([{ type: 'object' }]);
      for (const value of [{ nested: { x: 1 } }, [1, 2], 'a JSON string', null])
        expect((await driver.query('SELECT $1::jsonb AS value', [JSON.stringify(value)]))[0].value).toEqual(value);
    } finally { await close(); }
  }, 120000);

  it.each(['split', 'empty', 'schema', 'ungrounded', 'fallback', 'authentication'] as const)('keeps Insight checkpoints consistent for Gemini %s output', async scenario => {
    const valid = scenario === 'split' || scenario === 'fallback';
    const { repo, close } = await createWireTestRepository();
    try {
      vi.stubGlobal('fetch', vi.fn(() => { throw new Error('REAL_PROVIDER_FORBIDDEN'); }));
      const accepted = await repo.enqueueAgentTurn(TEST_USERS.owner, {
        ...input, client_turn_id: randomUUID(),
      }, `insight-thought-${valid}`);
      await dispatchAgentTurn(repo, (await repo.claimAgentTurnJob(`insight-thought-${valid}`))!, { log: vi.fn(), error: vi.fn() });
      const lease = (await repo.claimRun(`insight-thought-${valid}`, new Date(), 120000))!;
      let beforeInsight: Artifact[] = [];
      const provider = new GeminiProvider('fake-key', 'fake-model', async (_url, init) => {
        beforeInsight = (await repo.artifacts(TEST_USERS.owner, TEST_ORGS.alpha, lease.run.run_id)).artifacts;
        if (scenario === 'authentication') return Response.json({ error: {
          message: 'private provider response', details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }],
        } }, { status: 401 });
        const request = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
        const claimIds = (JSON.parse(request.contents[0]!.parts[0]!.text) as {
          claims: Array<{ claim_id: string }>;
        }).claims.map(claim => claim.claim_id);
        const text = JSON.stringify(scenario === 'schema' ? { summary_key: 'incorrect', claim_ids: claimIds }
          : { summary_key: 'inventory_descriptive', claim_ids: scenario === 'ungrounded' ? ['invented-claim'] : claimIds });
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [
          { thought: true, text: 'not structured output' },
          ...(['empty', 'fallback'].includes(scenario) ? [] : [{ text: text.slice(0, 40) }, { text: text.slice(40) }]),
        ] } }] }));
      });
      const fallback = vi.fn(async (claims: Parameters<GeminiProvider['narrate']>[0]) => {
        if (scenario === 'fallback') return { summary: SAFE_SUMMARY, claims, provider: 'openai' as const };
        throw Object.assign(new Error('private provider response'), {
          status: scenario === 'authentication' ? 401 : 429,
          code: scenario === 'authentication' ? 'invalid_api_key' : undefined,
        });
      });
      const workerErrors = vi.fn();
      await dispatchWorkflow(repo, lease, { log: vi.fn(), error: workerErrors,
        agentWorkflow: (repository, claimed, options) => executeAgentWorkflow(repository, claimed, {
          ...options, narrativeProvider: new FallbackNarrativeProvider([provider, { narrate: fallback }]),
        }),
      });
      const detail = await repo.getRun(TEST_USERS.owner, TEST_ORGS.alpha, lease.run.run_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, TEST_ORGS.alpha, lease.run.run_id);
      const runtime = await repo.getRunRuntime(TEST_USERS.owner, TEST_ORGS.alpha, lease.run.run_id);
      expect(beforeInsight.length).toBeGreaterThan(0);
      for (const artifact of beforeInsight) {
        expect(bundle.artifacts.find(saved => saved.artifact_id === artifact.artifact_id)).toEqual(artifact);
        expect(() => verifyArtifact(artifact)).not.toThrow();
      }
      const dataPack = bundle.artifacts.find(artifact => artifact.kind === 'data_analysis_pack')!;
      const dataEvidence = runtime.records.find(record => record.tool_name === 'data.evidence')!;
      expect(dataEvidence.status).toBe('completed');
      expect(dataPack.kind).toBe('data_analysis_pack');
      if (dataPack.kind === 'data_analysis_pack') {
        // Runtime references are restricted to the artifacts returned by this
        // tool. Comparison references still live in the immutable Data pack.
        expect(dataPack.payload.evidence_refs).toHaveLength(28);
        expect(dataEvidence.evidence_refs).toHaveLength(26);
        expect(dataEvidence.evidence_refs).toEqual(dataPack.payload.evidence_refs
          .filter(ref => dataEvidence.artifact_refs?.includes(ref.artifact_id))
          .map(ref => `${ref.artifact_id}:${ref.path}`));
      }
      expect(projectQueryUsage(detail.run, bundle.artifacts, bundle.validations)).toEqual({ used: 1, total: 1 });
      const dataArtifacts = bundle.artifacts.filter(artifact => ['query', 'query_result', 'calculation', 'data_analysis_pack', 'comparison_pack'].includes(artifact.kind));
      expect(dataArtifacts).toHaveLength(5);
      for (const artifact of dataArtifacts) {
        expect(artifact).toMatchObject({ org_id: lease.run.org_id, run_id: lease.run.run_id, data_as_of: input.data_as_of });
        expect(bundle.validations.find(validation => validation.artifact_id === artifact.artifact_id)?.valid).toBe(true);
      }
      for (const kind of ['data', 'comparison', 'chart', 'analyst'])
        expect(detail.tasks.find(task => task.kind === kind)?.status).toBe('succeeded');
      expect(runtime.records.find(record => record.step_key === 'team:insight')?.status).toBe(valid ? 'completed' : 'failed');
      expect(detail.run.status).toBe(valid ? 'succeeded' : 'failed');
      expect(bundle.artifacts.some(artifact => artifact.kind === 'insight_pack')).toBe(valid);
      expect(runtime.records.some(record => ['running', 'waiting', 'queued'].includes(record.status))).toBe(false);
      expect((await repo.listReports(TEST_USERS.owner, TEST_ORGS.alpha)).length).toBe(valid ? 1 : 0);
      if (valid) {
        expect(fallback).toHaveBeenCalledTimes(scenario === 'fallback' ? 1 : 0);
        expect(workerErrors).not.toHaveBeenCalled();
        expect(detail.tasks.every(task => task.status === 'succeeded')).toBe(true);
        expect(bundle.validations.every(validation => validation.valid)).toBe(true);
        const report = bundle.artifacts.find(artifact => artifact.kind === 'report')!;
        expect(report.kind).toBe('report');
        if (report.kind === 'report') expect(() => validateReport(report.payload, bundle.artifacts, detail.run.org_id, detail.run.run_id)).not.toThrow();
        expect(bundle.artifacts.find(artifact => artifact.kind === 'review_result')?.payload.status).toBe('PASS');
      } else {
        const errorCode = scenario === 'authentication' ? 'LLM_AUTHENTICATION_FAILED' : 'ALL_LLM_PROVIDERS_FAILED';
        expect(fallback).toHaveBeenCalledOnce();
        expect(detail.run.error_code).toBe(errorCode);
        expect(JSON.parse(workerErrors.mock.calls[0]![0])).toMatchObject({
          code: errorCode,
          provider_failure_codes: scenario === 'authentication' ? ['PROVIDER_HTTP_401', 'PROVIDER_HTTP_401']
            : [scenario === 'ungrounded' ? 'PROVIDER_UNGROUNDED_OUTPUT' : 'GEMINI_RESPONSE_INVALID', 'PROVIDER_HTTP_429'],
          provider_failure_reasons: scenario === 'authentication' ? ['unsupported_credentials', 'invalid_credentials']
            : [scenario === 'empty' ? 'empty_output' : scenario === 'schema' ? 'schema_mismatch' : 'ungrounded_claims', 'http_error'],
        });
        expect(workerErrors.mock.calls[0]![0]).not.toContain('private provider response');
        expect(bundle.artifacts.some(artifact => ['insight', 'report_draft', 'review_result', 'report'].includes(artifact.kind))).toBe(false);
        expect(detail.tasks.find(task => task.kind === 'insight')).toMatchObject({ status: 'failed', error_code: errorCode });
        await expect(repo.failRun(lease, 'MAX_ATTEMPTS')).rejects.toThrow();
        expect((await repo.getRun(TEST_USERS.owner, TEST_ORGS.alpha, lease.run.run_id)).run.error_code).toBe(errorCode);
        expect(await repo.claimRun('insight-invalid-reclaim', new Date(), 120000)).toBeNull();
      }
      const resumed = await repo.claimAgentTurnJob(`insight-thought-${valid}-completion`);
      if (resumed) await dispatchAgentTurn(repo, resumed, { log: vi.fn(), error: vi.fn() });
      const execution = await repo.getAgentTurnJob(TEST_USERS.owner, TEST_ORGS.alpha, accepted.job.job_id);
      expect(execution.job.status).toBe(valid ? 'completed' : 'failed');
      if (scenario === 'authentication') {
        expect(execution.job.error_code).toBe('LLM_AUTHENTICATION_FAILED');
        expect(execution.events.some(event => event.data.error_code === 'LLM_AUTHENTICATION_FAILED')).toBe(true);
        const messages = await repo.listMessages(TEST_USERS.owner, TEST_ORGS.alpha, accepted.job.conversation_id, { limit: 30, cursor: null });
        expect(messages.messages.find(message => message.message_id === accepted.job.assistant_message_id)?.parts)
          .toContainEqual({ type: 'error', code: 'LLM_AUTHENTICATION_FAILED', retryable: false });
      }
      expect(execution.invocations.find(invocation => invocation.step_key === 'data')?.status).toBe('completed');
      expect(execution.invocations.find(invocation => invocation.step_key === 'insight')?.status).toBe(valid ? 'completed' : 'failed');
      expect(execution.invocations.some(invocation => ['queued', 'running', 'waiting'].includes(invocation.status))).toBe(false);
    } finally { await close(); }
  }, 120000);

  it('terminalizes a real constraint failure and logs only allowlisted diagnostics', async () => {
    const { repo, driver, close } = await createWireTestRepository();
    try {
      vi.stubGlobal('fetch', vi.fn(() => { throw new Error('REAL_PROVIDER_FORBIDDEN'); }));
      const accepted = await repo.enqueueAgentTurn(TEST_USERS.owner, input, 'failed-wire-turn');
      await dispatchAgentTurn(repo, (await repo.claimAgentTurnJob('wire-failure'))!, { log: vi.fn(), error: vi.fn() });
      const lease = (await repo.claimRun('wire-failure', new Date(), 120000))!;
      const record = repo.recordRuntimeActivity.bind(repo);
      let injected = false;
      vi.spyOn(repo, 'recordRuntimeActivity').mockImplementation(async (lease, activity) => {
        if (!injected && activity.kind === 'tool' && activity.status === 'completed') {
          injected = true;
          await driver.query(`INSERT INTO agent_memory(org_id,id,layer,scope_key,memory_key,summary,artifact_refs)
            VALUES($1,$2,'workspace','workspace','fault','sensitive diagnostic sentinel',$3::jsonb)`,
          [TEST_ORGS.alpha, randomUUID(), JSON.stringify({ invalid: 'private prompt sentinel' })]);
        }
        return record(lease, activity);
      });
      const errors = vi.fn();
      await dispatchWorkflow(repo, lease, { log: vi.fn(), error: errors,
        agentWorkflow: (repository, lease, options) => executeAgentWorkflow(repository, lease, { ...options,
          narrativeProvider: { narrate: async claims => ({ summary: SAFE_SUMMARY, claims, provider: 'gemini' }) },
        }),
      });
      const detail = await repo.getRun(TEST_USERS.owner, TEST_ORGS.alpha, lease.run.run_id);
      expect(detail.run.status).toBe('failed');
      expect(detail.run.error_code).not.toContain('23514');
      expect((await repo.getAgentTurnJob(TEST_USERS.owner, TEST_ORGS.alpha, accepted.job.job_id)).job.status).toBe('failed');
      const runtime = await repo.getRunRuntime(TEST_USERS.owner, TEST_ORGS.alpha, lease.run.run_id);
      expect(runtime.records.some(record => ['running', 'waiting', 'queued'].includes(record.status))).toBe(false);
      expect(JSON.parse(errors.mock.calls[0][0])).toMatchObject({ database_code: '23514', database_constraint: 'agent_memory_artifact_refs_check' });
      expect(errors.mock.calls.flat().join('')).not.toMatch(/sentinel|INSERT|parameters|detail/);
      const response = (await runtimeWorkspaceRoutes(context(repo, streamRequest(`runs/${lease.run.run_id}/events`))))!;
      const frames: SseFrame[] = [];
      await readSse(response, frame => frames.push(frame), 2_000_000);
      expect(JSON.parse(frames.at(-1)!.data)).toMatchObject({ status: 'failed' });
      expect(JSON.stringify(frames)).not.toMatch(/sentinel|23514|artifact_refs_check/);
    } finally { await close(); }
  }, 120000);
});

import { expect, test, type APIRequestContext } from '@playwright/test';
const org = '10000000-0000-4000-8000-000000000001';
const beta = '10000000-0000-4000-8000-000000000002';
const durableExecution = process.env.E2E_DURABLE_AGENT_EXECUTION === 'true';
const requestBody = {
  org_id: org,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Phân tích tồn kho',
  conversation_id: null,
};
const scoped = (path: string) => `/api${path}?org_id=${org}`;
const accounts = {
  owner: 'owner@vda.example.test',
  analyst: 'analyst@vda.example.test',
  viewer: 'viewer@vda.example.test',
  beta: 'beta@vda.example.test',
} as const;
async function login(api: APIRequestContext, role: keyof typeof accounts = 'owner') {
  const response = await api.post('/api/auth/login', {
    data: { email: accounts[role], password: 'local-test-only' },
  });
  expect(response.status()).toBe(200);
}
async function completed(api: APIRequestContext, id: string) {
  await expect
    .poll(async () => (await (await api.get(scoped(`/runs/${id}`))).json()).run.status, {
      timeout: 120_000,
    })
    .toBe('succeeded');
}
test('Next adapter persists thread context through PUT and enforces tenant access', async ({
  request,
}) => {
  test.skip(
    durableExecution,
    'A non-durable turn supplies the run reference for this adapter check.',
  );
  await login(request);
  const response = await request.post(`/api/conversations?org_id=${org}`, {
    data: {
      org_id: org,
      client_turn_id: crypto.randomUUID(),
      text: 'Show current available inventory.',
      scope: requestBody.scope,
      data_as_of: requestBody.data_as_of,
    },
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
  expect(response.status()).toBe(202);
  const accepted = await response.json();
  expect(accepted.run_id).toEqual(expect.any(String));
  const path = `/api/conversations/${accepted.conversation_id}/context?org_id=${org}`;
  const initialResponse = await request.get(path);
  expect(initialResponse.status()).toBe(200);
  const initial = await initialResponse.json();
  const updated = {
    ...initial,
    current_run_id: initial.current_run_id === accepted.run_id ? null : accepted.run_id,
  };
  const saved = await request.put(path, { data: updated });
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toEqual(updated);
  expect(await (await request.get(path)).json()).toEqual(updated);
  await login(request, 'beta');
  expect((await request.put(path, { data: updated })).status()).toBe(403);
  expect(
    (
      await request.put(`/api/conversations/${accepted.conversation_id}/context?org_id=${beta}`, {
        data: updated,
      })
    ).status(),
  ).toBe(404);
});
test('API: import, idempotency, report lineage, private export, scheduler and authorization', async ({
  request,
}) => {
  test.skip(durableExecution, 'This API scenario exercises the non-durable Runtime path.');
  expect((await request.get('/api/session')).status()).toBe(401);
  await login(request);
  const key = crypto.randomUUID();
  const [one, two] = await Promise.all(
    [1, 2].map(() =>
      request.post('/api/analyses', { data: requestBody, headers: { 'Idempotency-Key': key } }),
    ),
  );
  expect(one.status()).toBe(202);
  expect(two.status()).toBe(202);
  const accepted = await one.json();
  expect((await two.json()).run_id).toBe(accepted.run_id);
  expect(
    (
      await request.post('/api/analyses', {
        data: { ...requestBody, question: 'changed' },
        headers: { 'Idempotency-Key': key },
      })
    ).status(),
  ).toBe(409);
  await completed(request, accepted.run_id);
  expect(
    (await (await request.get(scoped(`/runs/${accepted.run_id}`))).json()).run.workflow_version,
  ).toBe('agent-v1');
  const briefResponse = await request.get(scoped(`/runs/${accepted.run_id}/brief`));
  expect(briefResponse.status()).toBe(200);
  expect(await briefResponse.json()).toMatchObject({
    run_id: accepted.run_id,
    requested_data_as_of: requestBody.data_as_of,
    decision_brief: { version: 'decision-brief-v1' },
  });
  const agentKey = crypto.randomUUID();
  const agentTurnBody = {
    org_id: org,
    client_turn_id: crypto.randomUUID(),
    text: 'Show current available inventory.',
    scope: requestBody.scope,
    data_as_of: requestBody.data_as_of,
  };
  const agentTurn = await request.post(`/api/conversations?org_id=${org}`, {
    data: agentTurnBody,
    headers: { 'Idempotency-Key': agentKey },
  });
  expect(agentTurn.status()).toBe(202);
  const agentAccepted = await agentTurn.json();
  expect(agentAccepted.assistant_status).toBe('in_progress');
  expect(agentAccepted.run_id).toBeTruthy();
  expect(
    await request
      .post(`/api/conversations?org_id=${org}`, {
        data: agentTurnBody,
        headers: { 'Idempotency-Key': agentKey },
      })
      .then((response) => response.json()),
  ).toEqual(agentAccepted);
  await completed(request, agentAccepted.run_id);
  await expect
    .poll(async () => {
      const response = await request.get(
        scoped(`/conversations/${agentAccepted.conversation_id}/messages`),
      );
      return response.json();
    })
    .toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: agentTurnBody.text }),
        expect.objectContaining({
          role: 'assistant',
          run_id: agentAccepted.run_id,
          status: 'completed',
          parts: expect.arrayContaining([expect.objectContaining({ type: 'report_ref' })]),
        }),
      ]),
    });
  const bundle = await (await request.get(scoped(`/runs/${accepted.run_id}/artifacts`))).json();
  expect(bundle.artifacts.length).toBeGreaterThanOrEqual(10);
  expect(bundle.sources).toHaveLength(1);
  const reports = await (await request.get(scoped('/reports'))).json();
  const report = reports.reports.find((r: { run_id: string }) => r.run_id === accepted.run_id);
  const exportResponse = await request.post(scoped(`/reports/${report.report_id}/exports`), {
    data: { format: 'json' },
  });
  expect(exportResponse.status()).toBe(200);
  const downloadUrl = (await exportResponse.json()).url;
  const exported = await request.get(downloadUrl);
  expect(exported.status()).toBe(200);
  expect(
    Object.fromEntries(
      (await exported.json()).payload.metrics.map((metric: { key: string; value: unknown }) => [
        metric.key,
        metric.value,
      ]),
    ),
  ).toMatchObject({ total_inventory: 12, available_inventory: 10, sold_units_30d: 1 });
  const schedule = await request.post('/api/report-definitions', {
    data: {
      org_id: org,
      name: 'E2E daily',
      scope: requestBody.scope,
      timezone: 'Asia/Bangkok',
      local_time: '06:00',
      data_as_of_policy: 'scheduled_date',
      enabled: true,
    },
  });
  expect(schedule.status()).toBe(201);
  const definition = await schedule.json();
  const trigger = () =>
    request.post(`/api/report-definitions/${definition.report_definition_id}/trigger`, {
      data: { org_id: org, scheduled_for: '2026-09-19T02:00:00Z' },
    });
  const scheduled = await trigger();
  expect(scheduled.status()).toBe(202);
  const scheduledId = (await scheduled.json()).run_id;
  expect((await (await trigger()).json()).run_id).toBe(scheduledId);
  await completed(request, scheduledId);
  const csv =
    'snapshot_date,market_external_id,market_name,project_external_id,project_name,zone_external_id,zone_name,unit_external_id,unit_code,unit_type,area_sqm,list_price,currency,status,available_since,sold_at\n2026-09-20,VN,Việt Nam (synthetic),P-ALPHA,Riverside (synthetic),Z-NORTH,North,E2E-NEW,E2E-NEW,apartment,80,123.45,VND,available,2026-09-01,';
  expect(
    (
      await request.post('/api/imports', { data: { org_id: org, source_name: 'e2e.csv', csv } })
    ).status(),
  ).toBe(201);
  expect(
    Object.fromEntries(
      (await (await request.get(downloadUrl)).json()).payload.metrics.map(
        (metric: { key: string; value: unknown }) => [metric.key, metric.value],
      ),
    ),
  ).toMatchObject({ total_inventory: 12, available_inventory: 10, sold_units_30d: 1 });
  await login(request, 'viewer');
  expect((await request.get(scoped(`/reports/${report.report_id}`))).status()).toBe(200);
  expect((await request.get(scoped(`/runs/${accepted.run_id}/brief`))).status()).toBe(200);
  expect(
    (
      await request.post('/api/analyses', {
        data: requestBody,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(`/api/conversations?org_id=${org}`, {
        data: { ...agentTurnBody, client_turn_id: crypto.randomUUID() },
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/imports', {
        data: { org_id: org, source_name: 'viewer.csv', csv },
      })
    ).status(),
  ).toBe(403);
  expect((await request.post('/api/scheduler/tick', { data: { org_id: org } })).status()).toBe(403);
  expect((await request.get(downloadUrl)).status()).toBe(403);
  expect(
    (
      await request.post(scoped(`/reports/${report.report_id}/exports`), {
        data: { format: 'csv' },
      })
    ).status(),
  ).toBe(200);
  await login(request, 'beta');
  for (const path of [
    `/runs/${accepted.run_id}`,
    `/runs/${accepted.run_id}/artifacts`,
    `/runs/${accepted.run_id}/brief`,
    `/reports/${report.report_id}`,
    `/conversations/${agentAccepted.conversation_id}`,
  ])
    expect((await request.get(scoped(path))).status()).toBe(403);
  expect((await request.get(`/api/runs/${accepted.run_id}?org_id=${beta}`)).status()).toBe(404);
  expect(
    (
      await request.post('/api/analyses', {
        data: requestBody,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })
    ).status(),
  ).toBe(403);
});
test('Agent-v1 API: persisted identities, private checkpoints and guarded follow-up', async ({
  request,
}) => {
  test.skip(durableExecution, 'This scenario exercises the non-durable Runtime path.');
  await login(request);
  const turn = await request.post(`/api/conversations?org_id=${org}`, {
    data: {
      org_id: org,
      client_turn_id: crypto.randomUUID(),
      text: 'Show current available inventory.',
      scope: requestBody.scope,
      data_as_of: requestBody.data_as_of,
    },
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
  const accepted = await turn.json();
  expect(turn.status(), JSON.stringify(accepted)).toBe(202);
  await completed(request, accepted.run_id);
  const detail = await (await request.get(scoped(`/runs/${accepted.run_id}`))).json();
  expect(detail.run).toMatchObject({ workflow_version: 'agent-v1', status: 'succeeded' });
  const statusResponse = await request.get(scoped(`/runs/${accepted.run_id}/workflow-status`));
  expect(statusResponse.status()).toBe(200);
  const status = await statusResponse.json();
  expect(status).toMatchObject({
    run_id: accepted.run_id,
    workflow_version: 'agent-v1',
    draft_revision: expect.any(Number),
    review: { status: 'PASS' },
    publication_status: 'succeeded',
  });
  expect(status.stages.map((stage: { agent: string }) => stage.agent).sort()).toEqual([
    'analyst',
    'chart',
    'comparison',
    'coordinator',
    'data',
    'insight',
    'report',
    'reviewer',
  ]);
  const initialMessages = await (
    await request.get(scoped(`/conversations/${accepted.conversation_id}/messages`))
  ).json();
  expect(
    initialMessages.messages
      .map((message: { sender_agent: string | null }) => message.sender_agent)
      .filter(Boolean)
      .sort(),
  ).toEqual([
    'analyst',
    'chart',
    'comparison',
    'coordinator',
    'data',
    'insight',
    'report',
    'reviewer',
  ]);
  const followUp = await request.post(
    `/api/conversations/${accepted.conversation_id}/messages?org_id=${org}`,
    {
      data: {
        org_id: org,
        client_turn_id: crypto.randomUUID(),
        text: 'Show the analysis findings.',
        scope: requestBody.scope,
        data_as_of: requestBody.data_as_of,
        agent_target: 'analyst',
      },
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    },
  );
  expect(followUp.status()).toBe(202);
  expect(await followUp.json()).toMatchObject({
    run_id: accepted.run_id,
    assistant_status: 'completed',
  });
  const messagesAfterFollowUp = await (
    await request.get(scoped(`/conversations/${accepted.conversation_id}/messages`))
  ).json();
  expect(messagesAfterFollowUp.messages.at(-1)).toMatchObject({
    sender_agent: 'analyst',
    parts: expect.arrayContaining([
      expect.objectContaining({
        type: 'artifact_ref',
        kind: 'analysis_pack',
        run_id: accepted.run_id,
      }),
    ]),
  });
  await login(request, 'viewer');
  expect((await request.get(scoped(`/runs/${accepted.run_id}/workflow-status`))).status()).toBe(
    403,
  );
});
test('Durable multi-agent projection persists through reload and exposes published report only after completion', async ({
  page,
}) => {
  test.setTimeout(600_000);
  test.skip(
    process.env.E2E_DURABLE_AGENT_EXECUTION !== 'true',
    'Run with E2E_DURABLE_AGENT_EXECUTION=true to exercise durable persona projection.',
  );
  await page.goto('/');
  await page.getByLabel('Email').fill(accounts.owner);
  await page.getByLabel('Mật khẩu').fill('local-test-only');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('navigation', { name: 'Điều hướng workspace' })).toBeVisible();
  await page.getByRole('link', { name: 'Trợ lý AI' }).click();
  await expect(page.getByRole('navigation', { name: 'Hội thoại và quy trình' })).toBeVisible();
  await page.getByLabel('Ngày chụp dữ liệu', { exact: true }).fill('2026-09-19');
  await page.getByLabel('Câu hỏi phân tích').fill('Analyze slow-moving inventory.');
  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/conversations',
  );
  await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
  const accepted = await submitted;
  expect(accepted.status()).toBe(202);
  const { conversation_id: conversationId, agent_turn_job_id: jobId } = await accepted.json();
  expect(jobId).toEqual(expect.any(String));
  const rail = page.getByRole('navigation', { name: 'Hội thoại và quy trình' });
  await expect(
    rail.getByRole('button', { name: /Analyze slow-moving inventory/ }).first(),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Báo cáo đã phát hành' })).toHaveCount(0);
  await page.goto(`/chat/${conversationId}?org_id=${org}`);
  await page.reload();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(scoped(`/agent-turn-jobs/${jobId}`));
        expect(response.status()).toBe(200);
        return (await response.json()).job.status;
      },
      { timeout: 420_000 },
    )
    .toBe('completed');
  const dataAgent = rail.getByRole('button', { name: /Tác nhân dữ liệu ·/ });
  await expect(dataAgent).toBeVisible({ timeout: 30_000 });
  await dataAgent.click();
  await expect(dataAgent).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Hội thoại tác nhân data' })).toBeVisible();
  await expect(page).toHaveURL(/agent=data/);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Hội thoại tác nhân data' })).toBeVisible();
  const jobResponse = await page.request.get(scoped(`/agent-turn-jobs/${jobId}`));
  const runId = (await jobResponse.json()).job.run_id as string;
  const runtimeResponse = await page.request.get(scoped(`/runs/${runId}/runtime`));
  const runtime = await runtimeResponse.json();
  const requestRecord = runtime.records.find(
    (record: { step_key: string }) => record.step_key === 'team:insight:data-detail:request',
  );
  const childRecord = runtime.records.find(
    (record: { step_key: string }) => record.step_key === 'team:insight:data-detail',
  );
  expect(requestRecord?.activity_id).toEqual(expect.any(String));
  expect(childRecord?.activity_id).toEqual(expect.any(String));
  const focusUrl = new URL(`/chat/${conversationId}`, page.url());
  focusUrl.searchParams.set('org_id', org);
  focusUrl.searchParams.set('agent', 'insight');
  focusUrl.searchParams.set('item', `activity:${requestRecord.activity_id}`);
  focusUrl.searchParams.set('run', runId);
  focusUrl.searchParams.set('source', 'runtime');
  focusUrl.searchParams.set('invocation', childRecord.activity_id);
  await page.goto(focusUrl.toString());
  await expect(
    page.locator(`[data-agent-item="activity:${requestRecord.activity_id}"]`),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Mở hội thoại Tác nhân dữ liệu/ })).toBeVisible();
  await page.getByRole('button', { name: /Mở hội thoại Tác nhân dữ liệu/ }).click();
  await expect(page).toHaveURL(/agent=data/);
  await expect(
    page.locator(`[data-agent-item="activity:${requestRecord.activity_id}"]`),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Báo cáo đã phát hành' })).toBeVisible({
    timeout: 120_000,
  });
  await page.getByRole('button', { name: 'Mở báo cáo và in' }).click();
  await expect(page).toHaveURL(/\/reports\//);
});
test('Agent Workspace accepts analysis and keeps viewer controls read-only', async ({ page }) => {
  test.skip(durableExecution, 'The durable browser scenario exercises its own job timeline.');
  await page.goto('/');
  await page.getByLabel('Email').fill(accounts.owner);
  await page.getByLabel('Mật khẩu').fill('local-test-only');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('navigation', { name: 'Điều hướng workspace' })).toBeVisible();
  await page.getByRole('link', { name: 'Trợ lý AI' }).click();
  await expect(page.getByRole('combobox', { name: 'Dự án phân tích', exact: true })).toHaveValue(
    'P-ALPHA',
  );
  await page.getByLabel('Ngày chụp dữ liệu', { exact: true }).fill('2026-09-19');
  await page.getByLabel('Câu hỏi phân tích').fill('Show current available inventory.');
  await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Hội thoại và quy trình' })
      .getByRole('button', { name: /Show current available inventory/ })
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('tabpanel', { name: 'Lượt chạy' })).toBeVisible({ timeout: 30_000 });
  expect((await page.request.post('/api/auth/logout')).status()).toBe(200);
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { email: accounts.viewer, password: 'local-test-only' },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`/chat?org_id=${org}`);
  await expect(page.getByRole('button', { name: 'Gửi yêu cầu', exact: true })).toBeDisabled();
});

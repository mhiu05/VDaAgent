import { expect, test, type APIRequestContext } from '@playwright/test';
const org = '10000000-0000-4000-8000-000000000001';
const beta = '10000000-0000-4000-8000-000000000002';
const requestBody = {
  org_id: org,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Phân tích tồn kho',
  conversation_id: null,
};
const scoped = (path: string) => `/api/v1${path}?org_id=${org}`;
const accounts = {
  owner: 'owner@vda.example.test',
  analyst: 'analyst@vda.example.test',
  viewer: 'viewer@vda.example.test',
  beta: 'beta@vda.example.test',
} as const;
async function login(api: APIRequestContext, role: keyof typeof accounts = 'owner') {
  const response = await api.post('/api/v1/auth/login', {
    data: { email: accounts[role], password: 'local-test-only' },
  });
  expect(response.status()).toBe(200);
}
async function completed(api: APIRequestContext, id: string) {
  await expect
    .poll(async () => (await (await api.get(scoped(`/runs/${id}`))).json()).run.status, {
      timeout: 30_000,
    })
    .toBe('succeeded');
}
test('API: import, idempotency, report lineage, private export, scheduler and authorization', async ({
  request,
}) => {
  expect((await request.get('/api/v1/session')).status()).toBe(401);
  await login(request);
  const key = crypto.randomUUID();
  const [one, two] = await Promise.all(
    [1, 2].map(() =>
      request.post('/api/v1/analyses', { data: requestBody, headers: { 'Idempotency-Key': key } }),
    ),
  );
  expect(one.status()).toBe(202);
  expect(two.status()).toBe(202);
  const accepted = await one.json();
  expect((await two.json()).run_id).toBe(accepted.run_id);
  expect(
    (
      await request.post('/api/v1/analyses', {
        data: { ...requestBody, question: 'changed' },
        headers: { 'Idempotency-Key': key },
      })
    ).status(),
  ).toBe(409);
  await completed(request, accepted.run_id);
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
  const agentTurn = await request.post('/api/v1/conversations', {
    data: agentTurnBody,
    headers: { 'Idempotency-Key': agentKey },
  });
  expect(agentTurn.status()).toBe(202);
  const agentAccepted = await agentTurn.json();
  expect(agentAccepted.assistant_status).toBe('in_progress');
  expect(agentAccepted.run_id).toBeTruthy();
  expect(
    await request
      .post('/api/v1/conversations', {
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
  expect(bundle.artifacts).toHaveLength(10);
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
  const schedule = await request.post('/api/v1/report-definitions', {
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
    request.post(`/api/v1/report-definitions/${definition.report_definition_id}/trigger`, {
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
      await request.post('/api/v1/imports', { data: { org_id: org, source_name: 'e2e.csv', csv } })
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
      await request.post('/api/v1/analyses', {
        data: requestBody,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/v1/conversations', {
        data: { ...agentTurnBody, client_turn_id: crypto.randomUUID() },
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/v1/imports', {
        data: { org_id: org, source_name: 'viewer.csv', csv },
      })
    ).status(),
  ).toBe(403);
  expect((await request.post('/api/v1/scheduler/tick', { data: { org_id: org } })).status()).toBe(
    403,
  );
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
  expect((await request.get(`/api/v1/runs/${accepted.run_id}?org_id=${beta}`)).status()).toBe(404);
  expect(
    (
      await request.post('/api/v1/analyses', {
        data: requestBody,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })
    ).status(),
  ).toBe(403);
});
test('Owner UI: Project → evidence → report; analyst Zone; viewer read-only', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(accounts.owner);
  await page.getByLabel('Mật khẩu').fill('local-test-only');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('combobox', { name: 'Dự án', exact: true })).toHaveValue('P-ALPHA');
  await page.getByLabel('Ngày dữ liệu', { exact: true }).fill('2026-09-19');
  await page.getByLabel('Câu hỏi phân tích').fill('Show current available inventory.');
  await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
  await expect(page.getByText('Hoàn thành', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load detailed results', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dữ liệu từng sản phẩm' })).toBeVisible();
  await page.getByRole('button', { name: 'RS-001' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Hash nội dung');
  await page.getByRole('button', { name: 'Đóng bằng chứng' }).click();
  await page
    .getByRole('button', { name: /Mở báo cáo|Xem báo cáo/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'JSON', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/owner-report.png', fullPage: true });
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await page.getByLabel('Email').fill(accounts.analyst);
  await page.getByLabel('Mật khẩu').fill('local-test-only');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.getByRole('combobox', { name: 'Phân khu', exact: true }).selectOption('Z-NORTH');
  await page.getByLabel('Ngày dữ liệu', { exact: true }).fill('2026-09-19');
  await page.getByLabel('Câu hỏi phân tích').fill('Which units are slow moving?');
  await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
  await expect(page.getByText('P-ALPHA / Z-NORTH', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load detailed results', exact: true }).click();
  await expect(page.locator('.unit-section tbody tr')).toHaveCount(8);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/analyst-workspace.png', fullPage: true });
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await page.getByLabel('Email').fill(accounts.viewer);
  await page.getByLabel('Mật khẩu').fill('local-test-only');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('button', { name: 'Gửi yêu cầu', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Nguồn dữ liệu', exact: true }).click();
  await expect(page.getByLabel('Chọn tệp CSV')).toBeDisabled();
  await page.getByRole('button', { name: 'Lịch báo cáo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tạo lịch báo cáo' })).toBeDisabled();
});

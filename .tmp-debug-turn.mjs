import { randomUUID } from 'node:crypto';

const base = 'http://127.0.0.1:3000/api/v1';
const org = '10000000-0000-4000-8000-000000000001';
const login = await fetch(`${base}/auth/development-role`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ role: 'owner' }),
});
if (!login.ok) {
  console.log(JSON.stringify({ step: 'login', status: login.status }));
  process.exit(0);
}
const cookie = login.headers.get('set-cookie')?.split(';')[0];
const catalogResponse = await fetch(`${base}/catalog?org_id=${org}`, { headers: { cookie } });
if (!catalogResponse.ok) {
  console.log(JSON.stringify({ step: 'catalog', status: catalogResponse.status }));
  process.exit(0);
}
const catalog = await catalogResponse.json();
const project = catalog.projects?.[0]?.project_external_id;
if (!project) {
  console.log(JSON.stringify({ step: 'catalog', project: false }));
  process.exit(0);
}
const response = await fetch(`${base}/conversations?org_id=${org}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), cookie },
  body: JSON.stringify({
    org_id: org,
    client_turn_id: randomUUID(),
    text: 'Sản phẩm nào đang luân chuyển chậm?',
    scope: { project_external_id: project, zone_external_id: null },
    data_as_of: catalog.latest_snapshot_date ?? new Date().toISOString().slice(0, 10),
  }),
});
const result = await response.json();
console.log(JSON.stringify({ step: 'submit', status: response.status, title: result.title, detail: result.detail, accepted: Boolean(result.conversation_id) }));

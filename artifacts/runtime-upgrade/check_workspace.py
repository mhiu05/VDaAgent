"""Browser QA using responses captured from a real isolated PostgreSQL run."""
import json
import re
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

folder = Path(__file__).parent
fixture = json.loads((folder / 'fixture.json').read_text(encoding='utf-8'))
org = fixture['conversation']['org_id']
thread = fixture['conversation']['conversation_id']
run = fixture['runDetail']['run']['run_id']
context = fixture['threadContext'].copy()
errors = []
unknown = []
names = [('coordinator', 'Main Agent'), ('data', 'Data Agent'), ('comparison', 'Compare Agent'), ('insight', 'Insight Agent'), ('chart', 'Chart Agent'), ('report', 'Report Agent'), ('reviewer', 'Reviewer'), ('analyst', 'Analyst Agent')]
definitions = (folder.parents[1] / 'src/backend/packages/agents/src/runtime/team/definitions.ts').read_text(encoding='utf-8')
descriptions = dict(re.findall(r"definition\('([^']+)', '[^']+', '([^']+)'", definitions))
agents = [dict(id=key, name=name, role=key, description=descriptions[key], instructions='', allowed_tools=[], capabilities=[], avatar=dict(initials=name[0], color='#8b9aff')) for key, name in names]
imports = fixture['artifacts']['sources']
if not imports:
    imports = [dict(import_id='10000000-0000-4000-8000-000000000099', org_id=org, created_by=fixture['conversation']['created_by'], created_at='2026-09-26T00:00:00Z', source_name='Inventory-Q3.csv', file_hash='a'*64, row_count=24, storage_path=None, schema_version='csv-v1', provisional=True)]

def handle(route):
    global context
    request = route.request
    path = urlparse(request.url).path.removeprefix('/api/v1')
    status = 200
    if path == '/setup':
        value = dict(mode='supabase', llm_primary_provider='gemini', llm_fallback_provider='openai', grok_runtime_enabled=True, grok_workspace_enabled=True, grok_sse_enabled=True, development_role_bypass=False, ready=True, message='Isolated integration fixture')
    elif path == '/session':
        value = dict(user_id=fixture['conversation']['created_by'], email='owner@example.test', mode='supabase', organizations=[dict(org_id=org, name='Inventory workspace', role='owner')])
    elif path == '/catalog': value = fixture['catalog']
    elif path == '/agent-definitions': value = dict(agents=agents)
    elif path == '/imports': value = dict(imports=imports)
    elif path == '/reports': value = dict(reports=fixture['reports'])
    elif path == '/runs': value = dict(runs=[fixture['runDetail']['run']])
    elif path == '/conversations': value = dict(conversations=[dict(fixture['conversation'], latest_status='completed')], next_cursor=None)
    elif path == f'/conversations/{thread}': value = fixture['conversation']
    elif path == f'/conversations/{thread}/messages': value = dict(messages=fixture['messages'], next_cursor=None)
    elif path.startswith(f'/conversations/{thread}/messages/'):
        value = next((m for m in fixture['messages'] if m['message_id'] == path.split('/')[-1]), None)
    elif path == f'/conversations/{thread}/agent-turn-job': value = None
    elif path == f'/conversations/{thread}/context':
        if request.method == 'PUT': context = request.post_data_json
        value = context
    elif path == f'/conversations/{thread}/memory': value = dict(items=fixture['memory'])
    elif path == f'/runs/{run}': value = fixture['runDetail']
    elif path == f'/runs/{run}/runtime': value = fixture['runtime']
    elif path == f'/runs/{run}/artifacts': value = fixture['artifacts']
    elif path.startswith('/reports/'):
        report = next((r for r in fixture['reports'] if r['report_id'] == path.split('/')[-1]), None)
        artifact = next((a for a in fixture['artifacts']['artifacts'] if report and a['artifact_id'] == report['artifact_id']), None)
        value = dict(report=report, artifact=artifact)
    elif path.endswith('/workflow-status') or path.endswith('/brief') or path.endswith('/decision-intelligence'):
        status = 404
        value = dict(title='Not requested by this fixture', detail='Optional detail unavailable')
    else:
        unknown.append(path)
        status = 404
        value = dict(title='Unknown fixture route', detail=path)
    route.fulfill(status=status, content_type='application/json', body=json.dumps(value))

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport=dict(width=1600, height=1000), reduced_motion='reduce')
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/api/v1/**', handle)
    page.goto(f'http://127.0.0.1:3000/chat/{thread}?org_id={org}')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='Data Agent', exact=False).first.wait_for()
    original_url = page.url
    page.get_by_role('button', name='Data Agent', exact=False).first.click()
    assert page.url == original_url
    assert page.locator('select').filter(has=page.locator('option[value="data"]')).first.input_value() == 'data'
    page.get_by_label('Active dataset', exact=True).select_option(imports[0]['import_id'])
    page.wait_for_load_state('networkidle')
    assert context['dataset_ids'] == [imports[0]['import_id']]
    assert page.get_by_label('Analysis project', exact=True).input_value() == fixture['catalog']['projects'][0]['project_external_id']
    page.get_by_label('Active report').select_option('')
    page.wait_for_load_state('networkidle')
    assert context['active_report_id'] is None
    assert context['active_artifact_id'] is None
    assert page.url == original_url
    page.get_by_label('Active report').select_option(fixture['reports'][0]['report_id'])
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name="Reply with this message's artifact context", exact=True).first.click()
    page.get_by_role('button', name='Clear reply context', exact=True).wait_for()
    assert page.url == original_url
    page.get_by_role('button', name='Clear reply context', exact=True).click()
    assert page.get_by_role('button', name='Clear reply context', exact=True).count() == 0
    page.get_by_role('tab', name='Run', exact=True).click()
    page.locator('[class*="timeline"]').first.evaluate('(element) => { element.scrollTop = 0; }')
    assert page.locator('[class*="timeline"]').first.evaluate('''element => {
        const children = [...element.children];
        return children.every((child, index) => index === 0 || child.getBoundingClientRect().top >= children[index-1].getBoundingClientRect().bottom);
    }'''), 'Conversation sections must never overlap'
    page.screenshot(path=str(folder / 'desktop-workspace.png'), full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.get_by_role('button', name='Toggle run inspector').click()
    page.screenshot(path=str(folder / 'desktop-conversation.png'), full_page=True)
    page.get_by_role('button', name='Toggle run inspector').click()
    for width in [1024, 390, 320]:
        page.set_viewport_size(dict(width=width, height=900))
        page.wait_for_timeout(150)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow at {width}'
        page.screenshot(path=str(folder / f'{width}-workspace.png'), full_page=True)
    page.get_by_role('button', name='Toggle run inspector').click()
    page.get_by_role('dialog').wait_for(state='visible')
    page.screenshot(path=str(folder / 'mobile-inspector.png'), full_page=True)
    page.keyboard.press('Escape')
    assert page.get_by_role('dialog').count() == 0 or not page.get_by_role('dialog').first.is_visible()
    print(json.dumps(dict(page_errors=errors, unknown_routes=sorted(set(unknown)), screenshots=6, same_thread_recipient=True, no_report_context=True, imported_dataset_context=True, reply_context=True)))
    browser.close()
    assert not errors

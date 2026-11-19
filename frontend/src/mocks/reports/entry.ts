import type { Principal } from '../../shared/contracts/auth';
import type { MockContext } from '../core/scenarios';
import type { ReportsService } from '../../features/reports/services/reports-service';
import type { ReportsRepository } from '../../features/reports/model/types';
import { createReportsRepository } from './repository';
import { createReportFixtures, demoScope } from './fixtures';
import { createReportsScenario } from './scenarios';
import { createReportPresentationFixtures } from './presentation-fixtures';
import { projects } from '../dashboard/fixtures';
import { scopedPrincipal, serviceCall } from './integration';
import { RepositoryError } from '../../features/reports/model/types';
import type { Scenario } from '../core/scenarios';
import { ids } from '../core/ids';
import { createSchemaFixtures, showcaseTypes } from './schema-fixtures';

// The reserved Shell notification target resolves to an existing canonical record; no extra report is counted.
const canonicalReportId = (id: string) => id === ids.report ? 'R001' : id;
export const hasReport = (id: string, scenario: Scenario = 'success') => scenario === 'empty' ? false : scenario === 'performance' ? /^stress-\d{5}$/.test(id) && Number(id.slice(7)) < 10000 : /^R0(0[1-9]|1[0-8])$/.test(canonicalReportId(id)) || (['report-showcase', 'report-unknown-chart', 'report-invalid-chart', 'report-unknown-schema', 'report-unknown-type', 'report-empty-schema', 'report-large-table'].includes(scenario) && id === 'R019');
export function createReportsMockService(context: MockContext): ReportsService {
  const repositories = new Map<string, ReportsRepository>();
  let downloadFailure = context.scenario === 'error';
  const presentationScenario = context.scenario === 'report-no-chart' || context.scenario === 'report-no-kpi' || context.scenario === 'report-multiple-charts' || context.scenario === 'report-partial' ? context.scenario : null;
  const schemaScenario = ['report-showcase', 'report-unknown-chart', 'report-invalid-chart', 'report-unknown-schema', 'report-unknown-type', 'report-empty-schema', 'report-large-table'].includes(context.scenario);
  const seed = schemaScenario ? createSchemaFixtures(context.scenario) : presentationScenario ? createReportPresentationFixtures(presentationScenario) : context.scenario === 'out-of-order' ? createReportsScenario('S09') : context.scenario === 'demo-replay' ? createReportsScenario('S08') : context.scenario === 'unsupported-capability' ? createReportsScenario('S18') : context.scenario === 'long-conversation' ? createReportsScenario('S10') : createReportFixtures();
  if (context.scenario === 'empty') { seed.records = []; seed.versions = []; seed.attempts = []; seed.artifacts = []; seed.evidence = []; }
  const stores = new Map<string, Promise<ReportsRepository>>();
  async function repository(principal: Principal) {
    scopedPrincipal(principal, 'USER');
    if (context.scenario === 'performance') {
      let store = stores.get(principal.id);
      if (!store) {
        store = import('./stress').then(({ createStressReports }) => { const data = createStressReports(); return createReportsRepository(data, { principal: scopedPrincipal(principal, 'USER', data.records.map(r => r.id)), clock: context.clock }); });
        stores.set(principal.id, store);
      }
      return store;
    }
    const scope = scopedPrincipal(principal, 'USER', seed.records.map(r => r.id));
    let instance = repositories.get(principal.id);
    if (!instance) {
      instance = createReportsRepository(seed, { principal: scope, clock: context.clock }); repositories.set(principal.id, instance);
    }
    return instance;
  }
  return {
    catalog: (p, signal) => serviceCall(context, async () => { scopedPrincipal(p, 'USER'); return { reportTypes: [...new Set(seed.records.map(r => r.type))].map(id => showcaseTypes.find(t => t.id === id) ?? { id, name: id }), projects: structuredClone([...projects]), authors: [...new Map(seed.records.map(r => [r.author.id, r.author])).values()], agents: [...new Set(seed.records.map(r => r.agent))].sort(), defaultScope: { ...demoScope } }; }, signal),
    list: (p, query, signal) => serviceCall(context, async () => (await repository(p)).list(query, signal), signal),
    detail: (p, id, version, signal) => serviceCall(context, async () => (await repository(p)).readDetail(canonicalReportId(id), version, signal), signal),
    download: (p, id, version, artifact, signal) => serviceCall(context, async () => { const repo = await repository(p); if (downloadFailure) { downloadFailure = false; throw new RepositoryError('unavailable', 'Demo artifact failure'); } return repo.resolveDownload(canonicalReportId(id), version, artifact, signal); }, signal),
    summarize: (p, scope, signal) => serviceCall(context, async () => (await repository(p)).summarize(scope, signal), signal),
    recent: (p, scope, limit, signal) => serviceCall(context, async () => (await repository(p)).readRecent(scope, limit, signal), signal),
    delete: (p, id, signal) => serviceCall(context, async () => (await repository(p)).delete(canonicalReportId(id), signal), signal),
    onChanged: () => () => undefined,
  };
}

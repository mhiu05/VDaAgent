import { afterEach, describe, expect, it } from 'vitest';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import {
  type AnalysisRequest,
  type Artifact,
  type ArtifactOf,
  type DataAnalysisPack,
} from '@vda/contracts';
import { executeLease, SAFE_SUMMARY, type NarrativeProvider } from './index';
import {
  buildDataAnalysisPack,
  calculateDataAgentOutput,
  validateDataAnalysisPack,
} from './analysis-v1/agents/data-agent';
import { createTestRepository } from '../../../tests/helpers/postgres.js';

const resources: { repo: Repository; close: () => Promise<void> }[] = [];
async function setup() {
  const { pg, repo } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  return repo;
}
afterEach(async () => {
  for (const { repo, close } of resources.splice(0)) {
    await repo.close();
    await close();
  }
});

const request: AnalysisRequest = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};
const deterministicProvider = (): NarrativeProvider => ({
  narrate: async (claims) => ({ summary: SAFE_SUMMARY, claims, provider: 'gemini' }),
});

function artifact<K extends Artifact['kind']>(artifacts: Artifact[], kind: K): ArtifactOf<K> {
  const found = artifacts.find((candidate) => candidate.kind === kind);
  if (!found) throw new Error(`MISSING_${kind.toUpperCase()}`);
  return found as ArtifactOf<K>;
}

async function runAndBuild(repo: Repository, key: string): Promise<DataAnalysisPack> {
  const created = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun(`${key}-worker`);
  if (!lease) throw new Error('LEASE_REQUIRED');
  await executeLease(repo, lease, deterministicProvider());
  const [{ run }, { artifacts }] = await Promise.all([
    repo.getRun(TEST_USERS.owner, created.org_id, created.run_id),
    repo.artifacts(TEST_USERS.owner, created.org_id, created.run_id),
  ]);
  return buildDataAnalysisPack({
    run,
    query: artifact(artifacts, 'query'),
    query_result: artifact(artifacts, 'query_result'),
    calculation: artifact(artifacts, 'calculation'),
    comparison_calculation: artifact(artifacts, 'comparison_calculation'),
    comparison: artifact(artifacts, 'comparison'),
  });
}

describe('Data Agent canonical pack', () => {
  it('is an exact deterministic projection of immutable Data artifacts', async () => {
    const repo = await setup();
    const pack = await runAndBuild(repo, 'data-pack');
    expect(pack).toMatchObject({
      use_case: 'slow_moving_inventory',
      semantic_version: 'mvp-inventory-v0.2',
      dataset: { row_count: 12 },
      metric_config: { slow_moving_threshold_days: 90 },
    });
    expect(pack.evidence_refs.some((ref) => ref.path === 'payload')).toBe(true);

    const [{ run }, { artifacts }] = await Promise.all([
      repo.getRun(TEST_USERS.owner, request.org_id, pack.run_id),
      repo.artifacts(TEST_USERS.owner, request.org_id, pack.run_id),
    ]);
    const output = calculateDataAgentOutput(
      run,
      artifact(artifacts, 'query_result').payload.rows,
      90,
    );
    expect(pack.metrics).toEqual(output.calculation.metrics);
    expect(pack.peer_items).toEqual(output.peer_items);
    expect(() =>
      validateDataAnalysisPack(pack, {
        run,
        query: artifact(artifacts, 'query'),
        query_result: artifact(artifacts, 'query_result'),
        calculation: artifact(artifacts, 'calculation'),
        comparison_calculation: artifact(artifacts, 'comparison_calculation'),
        comparison: artifact(artifacts, 'comparison'),
      }),
    ).not.toThrow();
  });

  it('rejects a pack whose copied numeric value differs from canonical calculation evidence', async () => {
    const repo = await setup();
    const pack = await runAndBuild(repo, 'data-pack-tamper');
    const [{ run }, { artifacts }] = await Promise.all([
      repo.getRun(TEST_USERS.owner, request.org_id, pack.run_id),
      repo.artifacts(TEST_USERS.owner, request.org_id, pack.run_id),
    ]);
    const changed = structuredClone(pack);
    changed.metrics[0]!.value = 999;
    expect(() =>
      validateDataAnalysisPack(changed, {
        run,
        query: artifact(artifacts, 'query'),
        query_result: artifact(artifacts, 'query_result'),
        calculation: artifact(artifacts, 'calculation'),
        comparison_calculation: artifact(artifacts, 'comparison_calculation'),
        comparison: artifact(artifacts, 'comparison'),
      }),
    ).toThrow('DATA_AGENT_LINEAGE_MISMATCH');
  });
});

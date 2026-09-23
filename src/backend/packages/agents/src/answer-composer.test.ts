import { describe, expect, it, vi } from 'vitest';
import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactSchema,
  type Artifact,
  type ArtifactOf,
  type AvailableWorkspaceActionV1,
  type CanonicalAgentObservationV1,
  type GroundedResponseSelectionV1,
  GroundedResponseSelectionV1Schema,
  type UnitSnapshot,
} from '@vda/contracts';
import { analyze } from '@vda/semantic';
import type { Repository } from '@vda/db';
import { artifactHash } from './integrity';
import { GroundingValidationError, validateAndRenderGroundedResponse } from './answer-composer';
import type { AuthorizedAgentContextV1 } from './runtime-context';

const ORG = '10000000-0000-4000-8000-000000000001';
const RUN = '50000000-0000-4000-8000-000000000001';
const ARTIFACT = '50000000-0000-4000-8000-000000000002';
const TASK = '50000000-0000-4000-8000-000000000003';

function calculation(): ArtifactOf<'calculation'> {
  const body = {
    artifact_id: ARTIFACT,
    org_id: ORG,
    run_id: RUN,
    task_id: TASK,
    kind: 'calculation' as const,
    schema_version: ARTIFACT_SCHEMA_VERSION,
    created_at: '2026-09-19T00:00:00.000Z',
    semantic_version: 'mvp-inventory-v0.2' as const,
    provisional: true as const,
    data_as_of: '2026-09-19',
    input_refs: [],
    snapshot_refs: [],
    source_refs: [],
    limitations: [],
    payload: analyze(
      [
        {
          org_id: ORG,
          import_id: '30000000-0000-4000-8000-000000000001',
          snapshot_id: '40000000-0000-4000-8000-000000000001',
          snapshot_date: '2026-09-19',
          market_external_id: 'VN',
          market_name: 'Vietnam',
          project_external_id: 'P-ALPHA',
          project_name: 'Alpha',
          zone_external_id: 'Z-NORTH',
          zone_name: 'North',
          unit_external_id: '50000000-0000-4000-8000-000000000001',
          unit_code: 'A-01',
          unit_type: 'apartment',
          area_sqm: '100',
          list_price: '3000000000',
          currency: 'VND',
          status: 'available',
          available_since: '2026-06-21',
          sold_at: null,
          bedrooms: null,
        } satisfies UnitSnapshot,
      ],
      ORG,
      { project_external_id: 'P-ALPHA', zone_external_id: null },
      '2026-09-19',
    ),
  };
  return ArtifactSchema.parse({
    ...body,
    content_hash: artifactHash(body as Omit<Artifact, 'content_hash'>),
  }) as ArtifactOf<'calculation'>;
}

function context(): AuthorizedAgentContextV1 {
  return {
    org_id: ORG,
    actor: { user_id: '20000000-0000-4000-8000-000000000001', role: 'owner' },
    allowed_run_ids: [RUN],
    allowed_report_refs: [{ run_id: RUN, report_id: '50000000-0000-4000-8000-000000000004' }],
    allowed_evidence_refs: [
      { run_id: RUN, artifact_id: ARTIFACT, evidence_path: 'payload.metrics[0].value' },
    ],
    active_run: { run_id: RUN },
    active_artifact: { run_id: RUN, artifact_id: ARTIFACT },
    allowed_dashboard: {
      kpi_ids: [],
      chart_ids: ['chart:authorized'],
      priority_entity_ids: ['entity:authorized'],
      insight_ids: [],
      action_candidate_ids: [],
      drilldown_ids: ['drilldown:authorized'],
    },
  } as unknown as AuthorizedAgentContextV1;
}

function observations(
  metricKey: ArtifactOf<'calculation'>['payload']['metrics'][number]['key'],
): CanonicalAgentObservationV1[] {
  return [
    {
      observation_id: 'authorized-inventory-metric',
      kind: 'metric',
      availability: 'available',
      canonical_text: 'The authorized inventory metric is available for review.',
      display_value: null,
      support_level: 'high',
      grounding_refs: [
        { type: 'run', ref: { run_id: RUN, status: 'succeeded' } },
        {
          type: 'metric',
          ref: {
            run_id: RUN,
            artifact_id: ARTIFACT,
            metric_key: metricKey,
            evidence_path: 'payload.metrics[0].value',
          },
        },
      ],
    },
  ];
}

function workspaceActions(): AvailableWorkspaceActionV1[] {
  return [
    {
      action_id: 'open-evidence',
      action: {
        type: 'open_evidence',
        run_id: RUN,
        artifact_id: ARTIFACT,
        evidence_path: 'payload.metrics[0].value',
      },
    },
  ];
}

function response(): GroundedResponseSelectionV1 {
  return {
    version: 'grounded-response-selection-v1',
    status: 'complete',
    title_key: 'analysis_answer',
    blocks: [{ kind: 'summary', observation_ids: ['authorized-inventory-metric'] }],
    workspace_action_ids: ['open-evidence'],
    queued_run_ref: null,
    error_code: null,
  };
}

describe('grounded answer composer', () => {
  it('rehydrates exact observation references and renders only bounded message parts', async () => {
    const artifact = calculation();
    const metric = artifact.payload.metrics[0];
    if (!metric) throw new Error('METRIC_REQUIRED');
    const repository = {
      publicArtifactById: vi.fn(async () => artifact),
      getRun: vi.fn(async () => ({ run: { run_id: RUN, status: 'succeeded' } })),
    } as unknown as Repository;

    const rendered = await validateAndRenderGroundedResponse(response(), {
      observations: observations(metric.key),
      available_workspace_actions: workspaceActions(),
      context: context(),
      repository,
    });

    expect(rendered.primary_run_id).toBe(RUN);
    expect(rendered.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'run_ref', run_id: RUN }),
        expect.objectContaining({ type: 'metric_ref' }),
        expect.objectContaining({ type: 'workspace_action' }),
      ]),
    );
    expect(rendered.content).toContain('Analysis answer');
    expect(rendered.content).toContain('The authorized inventory metric is available for review.');
    expect(repository.publicArtifactById).toHaveBeenCalledWith(
      expect.any(String),
      ORG,
      RUN,
      ARTIFACT,
    );
  });

  it('fails closed for forged IDs, forged/cross-run grounding, and free prose', async () => {
    const artifact = calculation();
    const metric = artifact.payload.metrics[0];
    if (!metric) throw new Error('METRIC_REQUIRED');
    const repository = {
      publicArtifactById: vi.fn(async () => artifact),
      getRun: vi.fn(async () => ({ run: { run_id: RUN, status: 'succeeded' } })),
    } as unknown as Repository;
    const base = response();
    const values = {
      available_workspace_actions: workspaceActions(),
      context: context(),
      repository,
    };

    const forgedId = structuredClone(base);
    forgedId.blocks[0]!.observation_ids = ['not-supplied-by-server'];
    await expect(
      validateAndRenderGroundedResponse(forgedId, { ...values, observations: observations(metric.key) }),
    ).rejects.toBeInstanceOf(GroundingValidationError);

    const forgedPath = observations(metric.key);
    const metricReference = forgedPath[0]!.grounding_refs.find(
      (reference) => reference.type === 'metric',
    );
    if (!metricReference || metricReference.type !== 'metric') throw new Error('METRIC_REFERENCE_REQUIRED');
    metricReference.ref.evidence_path = 'payload.metrics[99].value';
    await expect(
      validateAndRenderGroundedResponse(base, { ...values, observations: forgedPath }),
    ).rejects.toBeInstanceOf(GroundingValidationError);

    const crossRun = observations(metric.key);
    const runReference = crossRun[0]!.grounding_refs.find((reference) => reference.type === 'run');
    if (!runReference || runReference.type !== 'run') throw new Error('RUN_REFERENCE_REQUIRED');
    runReference.ref.run_id = '50000000-0000-4000-8000-000000000099';
    await expect(
      validateAndRenderGroundedResponse(base, { ...values, observations: crossRun }),
    ).rejects.toBeInstanceOf(GroundingValidationError);

    expect(
      GroundedResponseSelectionV1Schema.safeParse({
        ...base,
        narrative: 'Inventory 20 is a provider-authored finding.',
      }).success,
    ).toBe(false);
  });

  it('rechecks every selected workspace action against the authorized context allowlists', async () => {
    const artifact = calculation();
    const metric = artifact.payload.metrics[0];
    if (!metric) throw new Error('METRIC_REQUIRED');
    const repository = {
      publicArtifactById: vi.fn(async () => artifact),
      getRun: vi.fn(async () => ({ run: { run_id: RUN, status: 'succeeded' } })),
    } as unknown as Repository;
    const invalidActions: AvailableWorkspaceActionV1[] = [
      {
        action_id: 'unauthorized-chart',
        action: { type: 'focus_visual', run_id: RUN, chart_id: 'chart:not-authorized' },
      },
      {
        action_id: 'unauthorized-priority',
        action: {
          type: 'focus_priority_entity',
          run_id: RUN,
          priority_entity_id: 'entity:not-authorized',
        },
      },
      {
        action_id: 'unauthorized-drilldown',
        action: { type: 'open_drilldown', run_id: RUN, drilldown_id: 'drilldown:not-authorized' },
      },
      {
        action_id: 'unauthorized-evidence',
        action: {
          type: 'open_evidence',
          run_id: RUN,
          artifact_id: ARTIFACT,
          evidence_path: 'payload.metrics[0].key',
        },
      },
      {
        action_id: 'unauthorized-report',
        action: {
          type: 'open_dashboard',
          run_id: RUN,
          report_id: '50000000-0000-4000-8000-000000000099',
        },
      },
    ];

    for (const action of invalidActions) {
      await expect(
        validateAndRenderGroundedResponse(
          { ...response(), workspace_action_ids: [action.action_id] },
          {
            observations: observations(metric.key),
            available_workspace_actions: [action],
            context: context(),
            repository,
          },
        ),
      ).rejects.toBeInstanceOf(GroundingValidationError);
    }
  });

  it('preserves server-generated actions whose exact targets remain authorized', async () => {
    const artifact = calculation();
    const metric = artifact.payload.metrics[0];
    if (!metric) throw new Error('METRIC_REQUIRED');
    const repository = {
      publicArtifactById: vi.fn(async () => artifact),
      getRun: vi.fn(async () => ({ run: { run_id: RUN, status: 'succeeded' } })),
    } as unknown as Repository;
    const authorizedActions: AvailableWorkspaceActionV1[] = [
      {
        action_id: 'authorized-chart',
        action: { type: 'focus_visual', run_id: RUN, chart_id: 'chart:authorized' },
      },
      {
        action_id: 'authorized-priority',
        action: {
          type: 'focus_priority_entity',
          run_id: RUN,
          priority_entity_id: 'entity:authorized',
        },
      },
      {
        action_id: 'authorized-drilldown',
        action: { type: 'open_drilldown', run_id: RUN, drilldown_id: 'drilldown:authorized' },
      },
      ...workspaceActions(),
    ];

    for (const action of authorizedActions) {
      const rendered = await validateAndRenderGroundedResponse(
        { ...response(), workspace_action_ids: [action.action_id] },
        {
          observations: observations(metric.key),
          available_workspace_actions: [action],
          context: context(),
          repository,
        },
      );
      expect(rendered.parts).toContainEqual({ type: 'workspace_action', action: action.action });
    }
  });
});

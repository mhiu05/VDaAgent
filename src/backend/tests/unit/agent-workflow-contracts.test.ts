import { describe, expect, it } from 'vitest';
import {
  AgentKeySchema,
  AgentPlanV1Schema,
  AgentTurnRequestSchema,
  AgentWorkflowStatusSchema,
  AnalysisPackSchema,
  AnalysisRequestSchema,
  CapabilityResultV1Schema,
  ChartPackSchema,
  ComparisonPackSchema,
  CoordinatorDecisionSchema,
  DataAnalysisPackSchema,
  InsightPackSchema,
  MessageSchema,
  ReportDraftSchema,
  RunSchema,
  ReviewResultSchema,
  UseCaseDefinitionSchema,
  UseCaseKeySchema,
  WorkspaceContextV1Schema,
} from '@vda/contracts';
import { UnknownUseCaseError, getUseCaseDefinition, useCases } from '@vda/agents';
import { analyze, compare, selectLatest } from '@vda/semantic';
import { ORG, row } from '../fixtures/inventory';

const ids = {
  run: '50000000-0000-4000-8000-000000000001',
  user: '20000000-0000-4000-8000-000000000001',
  decision: '50000000-0000-4000-8000-000000000002',
  dataPack: '50000000-0000-4000-8000-000000000003',
  dataArtifact: '50000000-0000-4000-8000-000000000004',
  queryArtifact: '50000000-0000-4000-8000-000000000005',
  queryResultArtifact: '50000000-0000-4000-8000-000000000006',
  calculationArtifact: '50000000-0000-4000-8000-000000000007',
  comparisonCalculationArtifact: '50000000-0000-4000-8000-000000000008',
  comparisonPack: '50000000-0000-4000-8000-000000000009',
  comparisonArtifact: '50000000-0000-4000-8000-000000000010',
  chartPack: '50000000-0000-4000-8000-000000000011',
  chartArtifact: '50000000-0000-4000-8000-000000000012',
  analysisPack: '50000000-0000-4000-8000-000000000013',
  analysisArtifact: '50000000-0000-4000-8000-000000000014',
  insightPack: '50000000-0000-4000-8000-000000000015',
  insightArtifact: '50000000-0000-4000-8000-000000000016',
  draftPack: '50000000-0000-4000-8000-000000000017',
  draft: '50000000-0000-4000-8000-000000000018',
  draftArtifact: '50000000-0000-4000-8000-000000000019',
  reviewPack: '50000000-0000-4000-8000-000000000020',
  review: '50000000-0000-4000-8000-000000000021',
} as const;

const date = '2026-09-19';
const scope = { project_external_id: 'P-ALPHA', zone_external_id: null };
const legacyAnalysisRequest = {
  org_id: ORG,
  scope,
  data_as_of: date,
  question: 'Show slow-moving inventory.',
  conversation_id: null,
};
const sourceRow = row({ unit_external_id: 'contract-fixture' });
const calculation = analyze([sourceRow], ORG, scope, date);
const peerItems = compare(selectLatest([sourceRow], ORG, date, scope));
const evidence = {
  artifact_id: ids.calculationArtifact,
  artifact_key: 'calculation',
  path: 'payload.metrics[0].value',
};

function metadata(contractVersion: string, packId: string) {
  return {
    contract_version: contractVersion,
    pack_id: packId,
    run_id: ids.run,
    org_id: ORG,
    use_case: 'slow_moving_inventory',
    use_case_version: 'slow-moving-inventory-v1',
    scope,
    data_as_of: date,
    semantic_version: 'mvp-inventory-v0.2',
    input_refs: [ids.calculationArtifact],
    snapshot_refs: [sourceRow.snapshot_id],
    source_refs: [sourceRow.import_id],
    limitations: ['Synthetic fixture only.'],
  };
}

const dataAnalysisPack = {
  ...metadata('data-analysis-pack-v1', ids.dataPack),
  metric_config: { slow_moving_threshold_days: 90 },
  dataset: {
    row_count: 1,
    query_artifact_id: ids.queryArtifact,
    query_result_artifact_id: ids.queryResultArtifact,
    calculation_artifact_id: ids.calculationArtifact,
    comparison_calculation_artifact_id: ids.comparisonCalculationArtifact,
    comparison_artifact_id: ids.comparisonArtifact,
  },
  metrics: calculation.metrics,
  units: calculation.units,
  age_buckets: calculation.age_buckets,
  breakdowns: calculation.breakdowns,
  period_comparisons: calculation.period_comparisons,
  segment_comparisons: calculation.segment_comparisons,
  notable_changes: calculation.notable_changes,
  peer_items: peerItems,
  insight_candidates: calculation.insight_candidates,
  quality_limitations: calculation.quality_limitations,
  evidence_refs: [evidence],
};
const comparisonPack = {
  ...metadata('comparison-pack-v1', ids.comparisonPack),
  data_analysis_pack_artifact_id: ids.dataArtifact,
  comparisons: peerItems,
  period_comparisons: calculation.period_comparisons,
  segment_comparisons: calculation.segment_comparisons,
  notable_changes: calculation.notable_changes,
  evidence_refs: [evidence],
};
const chartPack = {
  ...metadata('chart-pack-v1', ids.chartPack),
  data_analysis_pack_artifact_id: ids.dataArtifact,
  charts: [
    {
      version: 'chart-spec-v1',
      rules_version: 'chart-rules-v0.2',
      chart_id: 'available_inventory',
      intent: 'inventory_kpi',
      chart_type: 'kpi',
      title: 'Available inventory',
      subtitle: null,
      purpose: 'Show the canonical available inventory value.',
      x_axis: null,
      y_axis: { label: 'Units', unit: 'count', min: 0, max: null },
      series: [
        {
          key: 'value',
          label: 'Available inventory',
          metric_key: 'available_inventory',
          unit: 'count',
          currency: null,
          value_format: 'integer',
          stack: null,
        },
      ],
      data: [{ value: 1 }],
      provenance: {
        input_artifact_ids: [ids.calculationArtifact],
        metric_keys: ['available_inventory'],
        bindings: [
          {
            data_index: 0,
            data_key: 'value',
            artifact_id: ids.calculationArtifact,
            evidence_path: 'payload.metrics[1].value',
            metric_key: 'available_inventory',
          },
        ],
      },
      limitations: [],
      generated_by: 'deterministic',
    },
  ],
  unavailable: [],
  evidence_refs: [evidence],
};
const analysisPack = {
  ...metadata('analysis-pack-v1', ids.analysisPack),
  data_analysis_pack_artifact_id: ids.dataArtifact,
  findings: [
    {
      finding_id: 'finding-available-inventory',
      candidate_id: 'candidate-available-inventory',
      category: 'trend',
      kind: 'descriptive',
      statement: 'Available inventory is grounded in the canonical metric.',
      metric_key: 'available_inventory',
      support_level: 'high',
      evidence_refs: [evidence],
      limitations: [],
    },
  ],
  evidence_refs: [evidence],
};
const claims = [
  {
    claim_id: 'claim-available-inventory',
    text: 'Available inventory is 1.',
    metric_key: 'available_inventory',
    value: 1,
    evidence_artifact_id: ids.calculationArtifact,
    evidence_path: 'payload.metrics[1].value',
  },
];
const insightPack = {
  ...metadata('insight-pack-v1', ids.insightPack),
  data_analysis_pack_artifact_id: ids.dataArtifact,
  comparison_pack_artifact_id: ids.comparisonArtifact,
  chart_pack_artifact_id: ids.chartArtifact,
  analysis_pack_artifact_id: ids.analysisArtifact,
  summary: 'A bounded, evidence-backed inventory summary.',
  claims,
  selected_finding_ids: ['finding-available-inventory'],
  evidence_refs: [evidence],
  provider: 'deterministic',
};
const report = {
  title: 'Slow-moving inventory',
  summary: 'A bounded, evidence-backed inventory summary.',
  claims,
  metrics: calculation.metrics,
  units: calculation.units,
  calculation_artifact_id: ids.calculationArtifact,
  chart_artifact_id: ids.chartArtifact,
  comparison_artifact_id: ids.comparisonArtifact,
  sections: [],
  limitations: ['Synthetic fixture only.'],
};
const reportDraft = {
  ...metadata('report-draft-v1', ids.draftPack),
  draft_id: ids.draft,
  revision: 1,
  data_analysis_pack_artifact_id: ids.dataArtifact,
  comparison_pack_artifact_id: ids.comparisonArtifact,
  chart_pack_artifact_id: ids.chartArtifact,
  analysis_pack_artifact_id: ids.analysisArtifact,
  insight_pack_artifact_id: ids.insightArtifact,
  report,
  evidence_refs: [evidence],
};
const reviewResult = {
  ...metadata('review-result-v1', ids.reviewPack),
  review_id: ids.review,
  draft_artifact_id: ids.draftArtifact,
  draft_id: ids.draft,
  draft_revision: 1,
  draft_content_hash: 'a'.repeat(64),
  status: 'PASS',
  issues: [],
  summary: 'The bounded fixture draft is reviewable.',
  provider: 'deterministic',
};

describe('Phase A agent-workflow contracts', () => {
  it('defaults legacy analysis, run, and Agent Chat requests to slow_moving_inventory', () => {
    expect(AnalysisRequestSchema.parse(legacyAnalysisRequest).use_case).toBe(
      'slow_moving_inventory',
    );
    expect(
      RunSchema.parse({
        run_id: ids.run,
        org_id: ORG,
        created_by: ids.user,
        request: legacyAnalysisRequest,
        status: 'queued',
        created_at: '2026-09-19T00:00:00.000Z',
        updated_at: '2026-09-19T00:00:00.000Z',
        idempotency_key: 'legacy-run',
        request_hash: 'legacy-request-hash',
        entrypoint: 'interactive',
        occurrence_id: null,
        attempt: 0,
        fencing_token: 0,
        lease_until: null,
        error_code: null,
        report_artifact_id: null,
        cancel_requested: false,
      }).request.use_case,
    ).toBe('slow_moving_inventory');
    expect(
      AgentTurnRequestSchema.parse({
        org_id: ORG,
        client_turn_id: ids.user,
        text: 'Show slow-moving inventory.',
        scope,
        data_as_of: date,
      }).use_case,
    ).toBe('slow_moving_inventory');
  });

  it('parses every major workflow boundary and rejects unexpected fields', () => {
    const fixtures = [
      [
        'CoordinatorDecision',
        CoordinatorDecisionSchema,
        {
          contract_version: 'coordinator-decision-v1',
          decision_id: ids.decision,
          org_id: ORG,
          use_case: 'slow_moving_inventory',
          use_case_version: 'slow-moving-inventory-v1',
          scope,
          requested_data_as_of: date,
          effective_data_as_of: date,
          comparison_windows_days: [7, 30, 90],
          entrypoint: 'interactive',
          requested_capability: 'analysis',
          agent_target: 'coordinator',
          action: 'new_run',
          reuse_run_id: null,
          unsupported_reason: null,
        },
      ],
      ['DataAnalysisPack', DataAnalysisPackSchema, dataAnalysisPack],
      ['ComparisonPack', ComparisonPackSchema, comparisonPack],
      ['ChartPack', ChartPackSchema, chartPack],
      ['AnalysisPack', AnalysisPackSchema, analysisPack],
      ['InsightPack', InsightPackSchema, insightPack],
      ['ReportDraft', ReportDraftSchema, reportDraft],
      ['ReviewResult', ReviewResultSchema, reviewResult],
    ] as const;

    for (const [name, schema, fixture] of fixtures) {
      expect(schema.safeParse(fixture).success, name).toBe(true);
      expect(schema.safeParse({ ...fixture, unexpected: true }).success, name).toBe(false);
    }
  });

  it('keeps the use-case registry closed to registered keys', () => {
    const definition = getUseCaseDefinition('slow_moving_inventory');
    expect(UseCaseDefinitionSchema.parse(definition)).toMatchObject({
      key: 'slow_moving_inventory',
      comparison_windows_days: [7, 30, 90],
    });
    expect(useCases).toContainEqual(definition);
    expect(getUseCaseDefinition(undefined)).toBe(definition);
    expect(UseCaseKeySchema.safeParse('unregistered_use_case').success).toBe(false);
    expect(AgentKeySchema.safeParse('unregistered_agent').success).toBe(false);
    expect(
      AnalysisRequestSchema.safeParse({
        ...legacyAnalysisRequest,
        use_case: 'unregistered_use_case',
      }).success,
    ).toBe(false);
    expect(() => getUseCaseDefinition('unregistered_use_case')).toThrow(UnknownUseCaseError);
  });

  it('keeps compact workflow status free of draft contents and strict', () => {
    const status = {
      run_id: ids.run,
      org_id: ORG,
      workflow_version: 'agent-v1',
      stages: [{ agent: 'reviewer', status: 'succeeded', error_code: null }],
      draft_revision: 2,
      review: { draft_revision: 2, status: 'PASS' },
      publication_status: 'succeeded',
    };
    expect(AgentWorkflowStatusSchema.parse(status)).toEqual(status);
    expect(
      AgentWorkflowStatusSchema.safeParse({ ...status, draft_content_hash: 'a'.repeat(64) })
        .success,
    ).toBe(false);
  });

  it('keeps legacy turns and messages compatible while validating workspace context strictly', () => {
    const legacyTurn = {
      org_id: ORG,
      client_turn_id: ids.user,
      text: 'Show slow-moving inventory.',
      scope,
      data_as_of: date,
    };
    expect(AgentTurnRequestSchema.parse(legacyTurn).workspace_context).toBeUndefined();
    const workspaceContext = {
      version: 1 as const,
      mode: 'agent_chat' as const,
      org_id: ORG,
      conversation_id: null,
      scope,
      data_as_of: date,
      active_run_ref: null,
      active_report_ref: null,
      active_artifact_ref: null,
      dashboard_selection: null,
      drilldown: null,
      evidence_ref: null,
    };
    expect(
      WorkspaceContextV1Schema.parse(workspaceContext),
    ).toMatchObject(workspaceContext);
    expect(
      AgentTurnRequestSchema.safeParse({
        ...legacyTurn,
        workspace_context: {
          ...workspaceContext,
          org_id: ids.user,
        },
      }).success,
    ).toBe(false);
    expect(
      WorkspaceContextV1Schema.safeParse({
        ...workspaceContext,
        drilldown: { run_id: ids.run, drilldown_id: 'd'.repeat(201) },
      }).success,
    ).toBe(false);

    const message = {
      message_id: ids.decision,
      org_id: ORG,
      conversation_id: ids.user,
      run_id: null,
      client_turn_id: null,
      role: 'assistant' as const,
      sender_agent: null,
      status: 'completed' as const,
      content: 'A legacy reference-only response.',
      parts: [{ type: 'run_ref' as const, run_id: ids.run, status: 'succeeded' as const }],
      created_at: '2026-09-19T00:00:00.000Z',
    };
    expect(MessageSchema.parse(message)).toMatchObject(message);
    expect(
      MessageSchema.safeParse({
        ...message,
        parts: [
          {
            type: 'metric_ref',
            ref: {
              run_id: ids.run,
              artifact_id: ids.calculationArtifact,
              metric_key: 'available_inventory',
              evidence_path: 'payload.metrics[0].value',
            },
          },
          {
            type: 'workspace_action',
            action: { type: 'focus_visual', run_id: ids.run, chart_id: 'available_inventory' },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('bounds and closes runtime plans before any executor is introduced', () => {
    const plan = {
      version: 'agent-plan-v1',
      intent: 'inspect',
      answer_mode: 'grounded',
      unsupported_reason: null,
      steps: [
        {
          step_id: 'inspect-result',
          capability_id: 'get_analysis_result',
          input: { run_id: ids.run },
        },
        {
          step_id: 'inspect-decision',
          capability_id: 'inspect_decision_intelligence',
          input: { run_id: ids.run },
        },
        {
          step_id: 'inspect-visual',
          capability_id: 'inspect_visual',
          input: { run_id: ids.run, chart_id: 'available_inventory' },
        },
      ],
    } as const;
    expect(AgentPlanV1Schema.parse(plan)).toMatchObject(plan);
    expect(AgentPlanV1Schema.safeParse({ ...plan, steps: [...plan.steps, plan.steps[0]] }).success).toBe(
      false,
    );
    expect(
      AgentPlanV1Schema.safeParse({
        ...plan,
        steps: [{ step_id: 'bad', capability_id: 'sql', input: { query: 'select 1' } }],
      }).success,
    ).toBe(false);
    expect(
      AgentPlanV1Schema.safeParse({
        ...plan,
        answer_mode: 'unsupported',
      }).success,
    ).toBe(false);
  });

  it('keeps capability observations compact and typed', () => {
    const observation = {
      version: 'capability-result-v1' as const,
      capability_id: 'inspect_decision_intelligence' as const,
      status: 'available' as const,
      observations: [
        {
          observation_id: 'inventory-priority',
          kind: 'decision' as const,
          availability: 'available' as const,
          canonical_text: 'Inventory priority requires attention.',
          display_value: null,
          support_level: 'high' as const,
          grounding_refs: [
            { type: 'run' as const, ref: { run_id: ids.run, status: 'succeeded' as const } },
          ],
        },
      ],
      available_workspace_actions: [],
      queued_run_ref: null,
      error_code: null,
    };
    expect(CapabilityResultV1Schema.parse(observation)).toMatchObject(observation);
    expect(
      CapabilityResultV1Schema.safeParse({
        ...observation,
        narrative: 'Provider-authored content is not a capability result.',
      }).success,
    ).toBe(false);
  });
});

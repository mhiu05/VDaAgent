import {
  GroundedResponseSelectionV1Schema,
  MessagePartSchema,
  type AvailableWorkspaceActionV1,
  type CanonicalAgentObservationV1,
  type GroundedResponseSelectionV1,
  type GroundingReference,
  type MessagePart,
  type RunReference,
  type WorkspaceActionV1,
} from '@vda/contracts';
import { readArtifactPath, verifyArtifact } from '@vda/domain';
import type { Repository } from '@vda/db';
import type { AuthorizedAgentContextV1 } from './runtime-context';

const MAX_MESSAGE_PARTS = 32;
const MAX_MESSAGE_CONTENT = 5_000;

const titleText: Record<GroundedResponseSelectionV1['title_key'], string> = {
  analysis_answer: 'Analysis answer',
  analysis_queued: 'Analysis queued',
  analysis_partial: 'Partial analysis answer',
  analysis_unavailable: 'Analysis unavailable',
};

export class GroundingValidationError extends Error {
  readonly code = 'GROUNDING_INVALID' as const;

  constructor() {
    super('GROUNDING_INVALID');
  }
}

export type RenderedGroundedResponse = {
  selection: GroundedResponseSelectionV1;
  content: string;
  parts: MessagePart[];
  primary_run_id: string | null;
};

function key(value: unknown) {
  return JSON.stringify(value);
}

function runIdForReference(reference: GroundingReference) {
  return reference.ref.run_id;
}

function sameRunReference(left: RunReference, right: RunReference) {
  return left.run_id === right.run_id && left.status === right.status;
}

function displayText(observation: CanonicalAgentObservationV1) {
  return observation.display_value
    ? `${observation.canonical_text}: ${observation.display_value}`
    : observation.canonical_text;
}

function selectedIds(selection: GroundedResponseSelectionV1) {
  return selection.blocks.flatMap((block) => block.observation_ids);
}

function assertUnique(values: readonly string[]) {
  if (new Set(values).size !== values.length) throw new GroundingValidationError();
}

function observationMap(observations: readonly CanonicalAgentObservationV1[]) {
  const byId = new Map<string, CanonicalAgentObservationV1>();
  for (const observation of observations) {
    if (byId.has(observation.observation_id)) throw new GroundingValidationError();
    byId.set(observation.observation_id, observation);
  }
  return byId;
}

function actionMap(actions: readonly AvailableWorkspaceActionV1[]) {
  const byId = new Map<string, AvailableWorkspaceActionV1>();
  for (const action of actions) {
    if (byId.has(action.action_id)) throw new GroundingValidationError();
    byId.set(action.action_id, action);
  }
  return byId;
}

async function publicArtifact(
  repository: Repository,
  context: AuthorizedAgentContextV1,
  runId: string,
  artifactId: string,
) {
  try {
    const artifact = await repository.publicArtifactById(
      context.actor.user_id,
      context.org_id,
      runId,
      artifactId,
    );
    verifyArtifact(artifact);
    return artifact;
  } catch {
    throw new GroundingValidationError();
  }
}

/**
 * Most metric evidence points at a canonical metric object, whose parent
 * repeats the metric key. Chart provenance also legitimately binds a metric
 * to an individual unit/comparison field (for example a peer median). In
 * that form the only authoritative key/path association is the validated
 * chart-pack binding itself. Keep that narrow exception server-side rather
 * than accepting a free metric-key/path pairing.
 */
async function metricBoundByActiveChartPack(
  reference: Extract<GroundingReference, { type: 'metric' }>,
  context: AuthorizedAgentContextV1,
  repository: Repository,
) {
  const chartPackRef = context.active_decision?.chart_pack_artifact_ref;
  if (!chartPackRef || chartPackRef.run_id !== reference.ref.run_id) return false;
  try {
    const chartPack = await publicArtifact(
      repository,
      context,
      chartPackRef.run_id,
      chartPackRef.artifact_id,
    );
    return (
      chartPack.kind === 'chart_pack' &&
      chartPack.payload.charts.some((chart) =>
        chart.provenance.bindings.some(
          (binding) =>
            binding.artifact_id === reference.ref.artifact_id &&
            binding.metric_key === reference.ref.metric_key &&
            binding.evidence_path === reference.ref.evidence_path,
        ),
      )
    );
  } catch {
    return false;
  }
}

async function reauthorizeReference(
  reference: GroundingReference,
  context: AuthorizedAgentContextV1,
  repository: Repository,
) {
  const runId = runIdForReference(reference);
  if (!context.allowed_run_ids.includes(runId)) throw new GroundingValidationError();
  if (reference.type === 'run') {
    try {
      const run = await repository.getRun(context.actor.user_id, context.org_id, runId);
      if (run.run.status !== reference.ref.status) throw new GroundingValidationError();
    } catch (error) {
      if (error instanceof GroundingValidationError) throw error;
      throw new GroundingValidationError();
    }
    return runId;
  }
  const artifact = await publicArtifact(repository, context, runId, reference.ref.artifact_id);
  if (reference.type === 'artifact') {
    if (artifact.kind !== reference.ref.kind) throw new GroundingValidationError();
  } else if (reference.type === 'claim') {
    const claims =
      artifact.kind === 'report' || artifact.kind === 'insight' || artifact.kind === 'insight_pack'
        ? artifact.payload.claims
        : [];
    if (!claims.some((claim) => claim.claim_id === reference.ref.claim_id))
      throw new GroundingValidationError();
  } else if (reference.type === 'metric') {
    try {
      readArtifactPath(artifact, reference.ref.evidence_path);
      const parentPath = reference.ref.evidence_path.replace(/\.[^.\[\]]+$/, '');
      const parent = readArtifactPath(artifact, parentPath);
      const matchesMetricKeyAtParent =
        Boolean(parent) &&
        typeof parent === 'object' &&
        ((parent as { key?: unknown; metric_key?: unknown }).key === reference.ref.metric_key ||
          (parent as { metric_key?: unknown }).metric_key === reference.ref.metric_key);
      if (!matchesMetricKeyAtParent && !(await metricBoundByActiveChartPack(reference, context, repository)))
        throw new GroundingValidationError();
    } catch {
      throw new GroundingValidationError();
    }
  } else if (reference.type === 'evidence') {
    if (
      !context.allowed_evidence_refs.some(
        (candidate) =>
          candidate.run_id === runId &&
          candidate.artifact_id === reference.ref.artifact_id &&
          candidate.evidence_path === reference.ref.evidence_path,
      )
    )
      throw new GroundingValidationError();
    try {
      readArtifactPath(artifact, reference.ref.evidence_path);
    } catch {
      throw new GroundingValidationError();
    }
  } else {
    const limitations = artifact.limitations;
    const known = limitations.some(
      (_limitation, index) =>
        reference.ref.quality_id === `${reference.ref.kind}-${index + 1}`,
    );
    if (!known) throw new GroundingValidationError();
  }
  return runId;
}

function actionRunId(action: WorkspaceActionV1) {
  return 'run_id' in action ? action.run_id : null;
}

async function reauthorizeAction(
  action: WorkspaceActionV1,
  context: AuthorizedAgentContextV1,
  repository: Repository,
  primaryRunId: string | null,
) {
  const runId = actionRunId(action);
  if (runId === null) throw new GroundingValidationError();
  if (!context.allowed_run_ids.includes(runId)) throw new GroundingValidationError();
  if (primaryRunId && runId !== primaryRunId) throw new GroundingValidationError();
  try {
    await repository.getRun(context.actor.user_id, context.org_id, runId);
  } catch {
    throw new GroundingValidationError();
  }
  if (action.type === 'open_dashboard') {
    if (
      action.report_id === null ||
      !context.allowed_report_refs.some(
        (reference) => reference.run_id === runId && reference.report_id === action.report_id,
      )
    )
      throw new GroundingValidationError();
    try {
      const report = await repository.getReport(context.actor.user_id, context.org_id, action.report_id);
      if (report.report.run_id !== runId) throw new GroundingValidationError();
      const artifact = await publicArtifact(
        repository,
        context,
        runId,
        report.report.artifact_id,
      );
      if (artifact.kind !== 'report') throw new GroundingValidationError();
    } catch (error) {
      if (error instanceof GroundingValidationError) throw error;
      throw new GroundingValidationError();
    }
  }
  if (action.type === 'open_drilldown') {
    if (
      context.active_run?.run_id !== runId ||
      !context.allowed_dashboard.drilldown_ids.includes(action.drilldown_id)
    )
      throw new GroundingValidationError();
  }
  if (action.type === 'focus_visual') {
    if (
      context.active_run?.run_id !== runId ||
      !context.allowed_dashboard.chart_ids.includes(action.chart_id)
    )
      throw new GroundingValidationError();
  }
  if (action.type === 'focus_priority_entity') {
    if (
      context.active_run?.run_id !== runId ||
      !context.allowed_dashboard.priority_entity_ids.includes(action.priority_entity_id)
    )
      throw new GroundingValidationError();
  }
  if (action.type === 'open_evidence') {
    if (
      action.evidence_path === null
        ? context.active_artifact?.run_id !== runId ||
          context.active_artifact.artifact_id !== action.artifact_id
        : !context.allowed_evidence_refs.some(
            (reference) =>
              reference.run_id === runId &&
              reference.artifact_id === action.artifact_id &&
              reference.evidence_path === action.evidence_path,
          )
    )
      throw new GroundingValidationError();
    const artifact = await publicArtifact(repository, context, runId, action.artifact_id);
    if (action.evidence_path !== null) {
      try {
        readArtifactPath(artifact, action.evidence_path);
      } catch {
        throw new GroundingValidationError();
      }
    }
  }
  return runId;
}

function groundingPart(reference: GroundingReference): MessagePart | null {
  if (reference.type === 'run')
    return { type: 'run_ref', run_id: reference.ref.run_id, status: reference.ref.status };
  if (reference.type === 'claim') return { type: 'claim_ref', ref: reference.ref };
  if (reference.type === 'metric') return { type: 'metric_ref', ref: reference.ref };
  if (reference.type === 'artifact')
    return {
      type: 'artifact_ref',
      run_id: reference.ref.run_id,
      artifact_id: reference.ref.artifact_id,
      kind: reference.ref.kind,
    };
  if (reference.type === 'evidence') return { type: 'evidence_ref', ref: reference.ref };
  return { type: 'quality_ref', ref: reference.ref };
}

function actionParts(action: WorkspaceActionV1): MessagePart[] {
  if (action.type === 'open_dashboard' && action.report_id)
    return [{ type: 'report_ref', run_id: action.run_id, report_id: action.report_id }];
  if (action.type === 'open_drilldown')
    return [{ type: 'drilldown_ref', run_id: action.run_id, drilldown_id: action.drilldown_id }];
  return [];
}

function renderContent(
  selection: GroundedResponseSelectionV1,
  observations: CanonicalAgentObservationV1[],
) {
  const blocks = selection.blocks
    .map((block) => {
      const content = block.observation_ids
        .map((id) => observations.find((observation) => observation.observation_id === id))
        .filter((observation): observation is CanonicalAgentObservationV1 => Boolean(observation))
        .map(displayText)
        .join('\n');
      return content;
    })
    .filter(Boolean);
  const values = [titleText[selection.title_key], ...blocks];
  let content = '';
  for (const value of values) {
    const next = content ? `${content}\n\n${value}` : value;
    if (next.length > MAX_MESSAGE_CONTENT) break;
    content = next;
  }
  return content || titleText.analysis_unavailable;
}

function statusIsCoherent(
  selection: GroundedResponseSelectionV1,
  observations: CanonicalAgentObservationV1[],
) {
  const availability = observations.map((observation) => observation.availability);
  if (selection.status === 'complete')
    return (
      selection.title_key === 'analysis_answer' &&
      selection.queued_run_ref === null &&
      selection.error_code === null &&
      availability.length > 0 &&
      availability.every((value) => value === 'available')
    );
  if (selection.status === 'partial')
    return (
      selection.title_key === 'analysis_partial' &&
      selection.queued_run_ref === null &&
      selection.error_code === null &&
      availability.some((value) => value === 'available') &&
      availability.some((value) => value !== 'available')
    );
  if (selection.status === 'queued')
    return (
      selection.title_key === 'analysis_queued' &&
      selection.queued_run_ref !== null &&
      selection.error_code === null &&
      availability.some((value) => value === 'pending')
    );
  return (
    selection.title_key === 'analysis_unavailable' &&
    selection.queued_run_ref === null &&
    selection.error_code === null &&
    availability.every((value) => value !== 'available')
  );
}

export async function validateAndRenderGroundedResponse(
  value: unknown,
  values: {
    observations: readonly CanonicalAgentObservationV1[];
    available_workspace_actions: readonly AvailableWorkspaceActionV1[];
    context: AuthorizedAgentContextV1;
    repository: Repository;
  },
): Promise<RenderedGroundedResponse> {
  const selection = GroundedResponseSelectionV1Schema.parse(value);
  const allObservations = observationMap(values.observations);
  const ids = selectedIds(selection);
  assertUnique(ids);
  assertUnique(selection.workspace_action_ids);
  const selected = ids.map((id) => {
    const observation = allObservations.get(id);
    if (!observation) throw new GroundingValidationError();
    return observation;
  });
  const requiredLimitationIds = values.observations
    .filter((observation) => observation.availability !== 'available')
    .map((observation) => observation.observation_id);
  if (requiredLimitationIds.some((id) => !ids.includes(id))) throw new GroundingValidationError();
  if (!statusIsCoherent(selection, selected)) throw new GroundingValidationError();
  const allActions = actionMap(values.available_workspace_actions);
  const actions = selection.workspace_action_ids.map((id) => {
    const action = allActions.get(id);
    if (!action) throw new GroundingValidationError();
    return action.action;
  });
  if (selection.status !== 'complete' && actions.length)
    throw new GroundingValidationError();

  let primaryRunId: string | null = null;
  let primaryRunStatus: RunReference['status'] | null = null;
  const grounding: GroundingReference[] = [];
  for (const observation of selected) {
    for (const reference of observation.grounding_refs) {
      const runId = await reauthorizeReference(reference, values.context, values.repository);
      if (primaryRunId && primaryRunId !== runId) throw new GroundingValidationError();
      primaryRunId = runId;
      if (reference.type === 'run') primaryRunStatus = reference.ref.status;
      grounding.push(reference);
    }
  }
  for (const action of actions) {
    const runId = await reauthorizeAction(
      action,
      values.context,
      values.repository,
      primaryRunId,
    );
    primaryRunId = primaryRunId ?? runId;
  }
  if (selection.status === 'queued') {
    const queued = selection.queued_run_ref;
    if (!queued || primaryRunId !== queued.run_id) throw new GroundingValidationError();
    const pendingRun = selected
      .filter((observation) => observation.availability === 'pending')
      .flatMap((observation) => observation.grounding_refs)
      .find(
        (reference): reference is Extract<GroundingReference, { type: 'run' }> =>
          reference.type === 'run',
      );
    if (!pendingRun || !sameRunReference(pendingRun.ref, queued))
      throw new GroundingValidationError();
    try {
      const current = await values.repository.getRun(
        values.context.actor.user_id,
        values.context.org_id,
        queued.run_id,
      );
      if (current.run.status !== queued.status) throw new GroundingValidationError();
    } catch (error) {
      if (error instanceof GroundingValidationError) throw error;
      throw new GroundingValidationError();
    }
    primaryRunStatus = queued.status;
  }
  if (selection.status !== 'unavailable' && !primaryRunId) throw new GroundingValidationError();

  const content = renderContent(selection, selected);
  const parts: MessagePart[] = [{ type: 'text', text: content }];
  if (primaryRunId)
    parts.push({ type: 'run_ref', run_id: primaryRunId, status: primaryRunStatus ?? 'succeeded' });
  const seen = new Set(parts.map(key));
  for (const reference of grounding) {
    const part = groundingPart(reference);
    if (!part || seen.has(key(part))) continue;
    seen.add(key(part));
    parts.push(part);
  }
  for (const action of actions) {
    const part = { type: 'workspace_action' as const, action };
    if (!seen.has(key(part))) {
      seen.add(key(part));
      parts.push(part);
    }
    for (const compatibilityPart of actionParts(action)) {
      if (seen.has(key(compatibilityPart))) continue;
      seen.add(key(compatibilityPart));
      parts.push(compatibilityPart);
    }
  }
  if (parts.length > MAX_MESSAGE_PARTS) throw new GroundingValidationError();
  return {
    selection,
    content,
    parts: MessagePartSchema.array().max(MAX_MESSAGE_PARTS).parse(parts),
    primary_run_id: primaryRunId,
  };
}

/** A provider outage cannot re-open a free-prose path. */
export async function deterministicGroundedAnswer(values: {
  observations: readonly CanonicalAgentObservationV1[];
  available_workspace_actions: readonly AvailableWorkspaceActionV1[];
  context: AuthorizedAgentContextV1;
  repository: Repository;
}): Promise<RenderedGroundedResponse> {
  const available = values.observations.filter(
    (observation) => observation.availability === 'available',
  );
  const limitations = values.observations.filter(
    (observation) => observation.availability !== 'available',
  );
  if (!available.length) {
    const pending = limitations.find((observation) => observation.availability === 'pending');
    const pendingRun = pending?.grounding_refs.find(
      (reference): reference is Extract<GroundingReference, { type: 'run' }> =>
        reference.type === 'run',
    );
    if (pending && pendingRun)
      return validateAndRenderGroundedResponse(
        {
          version: 'grounded-response-selection-v1',
          status: 'queued',
          title_key: 'analysis_queued',
          blocks: [{ kind: 'summary', observation_ids: [pending.observation_id] }],
          workspace_action_ids: [],
          queued_run_ref: pendingRun.ref,
          error_code: null,
        },
        values,
      );
    const ids = limitations.slice(0, 8).map((observation) => observation.observation_id);
    return validateAndRenderGroundedResponse(
      {
        version: 'grounded-response-selection-v1',
        status: 'unavailable',
        title_key: 'analysis_unavailable',
        blocks: ids.length ? [{ kind: 'limitation', observation_ids: ids }] : [],
        workspace_action_ids: [],
        queued_run_ref: null,
        error_code: null,
      },
      values,
    );
  }
  const summary = available[0]!;
  const detail = available.slice(1, 8);
  const partial = limitations.length > 0;
  return validateAndRenderGroundedResponse(
    {
      version: 'grounded-response-selection-v1',
      status: partial ? 'partial' : 'complete',
      title_key: partial ? 'analysis_partial' : 'analysis_answer',
      blocks: [
        { kind: 'summary', observation_ids: [summary.observation_id] },
        ...(detail.length
          ? [{ kind: 'detail' as const, observation_ids: detail.map((item) => item.observation_id) }]
          : []),
        ...(limitations.length
          ? [
              {
                kind: 'limitation' as const,
                observation_ids: limitations.slice(0, 4).map((item) => item.observation_id),
              },
            ]
          : []),
      ],
      workspace_action_ids: partial
        ? []
        : values.available_workspace_actions.slice(0, 8).map((action) => action.action_id),
      queued_run_ref: null,
      error_code: null,
    },
    values,
  );
}

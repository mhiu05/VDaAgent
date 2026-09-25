import {
  CapabilityResultV1Schema,
  type AgentCapabilityIdV1,
  type Artifact,
  type ArtifactReference,
  type AvailableWorkspaceActionV1,
  type CanonicalMetricRef,
  type CapabilityResultV1,
  type RunReference,
} from '@vda/contracts';
import type { Repository } from '@vda/db';
import { MAX_AGENT_GROUNDING_REFS_PER_OBSERVATION } from '../limits';
import type { AuthorizedAgentContextV1 } from '../context/types';
import type { AgentToolExecutionContext } from '../../chat/operations';
import { CapabilityRegistryError, type RuntimeCapabilityExecutionContext } from './contracts';

export function runRef(run: { run_id: string; status: RunReference['status'] }): RunReference {
  return { run_id: run.run_id, status: run.status };
}

export function artifactRef(artifact: Artifact): ArtifactReference {
  return { run_id: artifact.run_id, artifact_id: artifact.artifact_id, kind: artifact.kind };
}

export function boundedCanonicalText(value: string, fallback: string, maxLength = 900) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : fallback;
}

export function canonicalEvidenceValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof serialized !== 'string') return null;
  const normalized = serialized.trim();
  return normalized.length > 0 && normalized.length <= 240 ? normalized : null;
}

export function evidenceRefs(
  runId: string,
  values: readonly { artifact_id: string; path: string }[],
) {
  return values.slice(0, MAX_AGENT_GROUNDING_REFS_PER_OBSERVATION).map((value) => ({
    run_id: runId,
    artifact_id: value.artifact_id,
    evidence_path: value.path,
  }));
}

export function boundedGroundingRefs(values: readonly unknown[]) {
  return values.slice(0, MAX_AGENT_GROUNDING_REFS_PER_OBSERVATION);
}

type MetricReferenceSource = Pick<CanonicalMetricRef, 'artifact_id' | 'path' | 'metric_key'>;

export function metricRefs(runId: string, values: readonly MetricReferenceSource[]) {
  return values.slice(0, MAX_AGENT_GROUNDING_REFS_PER_OBSERVATION).map((value) => ({
    run_id: runId,
    artifact_id: value.artifact_id,
    metric_key: value.metric_key,
    evidence_path: value.path,
  }));
}

export function observation(
  id: string,
  kind: 'claim' | 'metric' | 'decision' | 'status' | 'limitation',
  availability: 'available' | 'unavailable' | 'pending' | 'failed',
  canonicalText: string,
  groundingRefs: unknown[],
  options: {
    display_value?: string | null;
    support_level?: 'high' | 'medium' | 'limited' | 'exploratory' | null;
  } = {},
) {
  return {
    observation_id: id,
    kind,
    availability,
    canonical_text: canonicalText,
    display_value: options.display_value ?? null,
    support_level: options.support_level ?? null,
    grounding_refs: groundingRefs,
  };
}

export function capabilityResult(
  capabilityId: AgentCapabilityIdV1,
  status: CapabilityResultV1['status'],
  observations: unknown[],
  values: {
    available_workspace_actions?: AvailableWorkspaceActionV1[];
    queued_run_ref?: RunReference | null;
    error_code?: CapabilityResultV1['error_code'];
  } = {},
) {
  try {
    return CapabilityResultV1Schema.parse({
      version: 'capability-result-v1',
      capability_id: capabilityId,
      status,
      observations,
      available_workspace_actions: values.available_workspace_actions ?? [],
      queued_run_ref: values.queued_run_ref ?? null,
      error_code: values.error_code ?? null,
    });
  } catch {
    throw new CapabilityRegistryError('CAPABILITY_OUTPUT_INVALID');
  }
}

export function unavailable(
  capabilityId: AgentCapabilityIdV1,
  id: string,
  text = 'An authorized result is unavailable for this request.',
) {
  return capabilityResult(
    capabilityId,
    'unavailable',
    [observation(id, 'limitation', 'unavailable', text, [])],
    { error_code: 'CAPABILITY_UNAVAILABLE' },
  );
}

export function safeReadFailure(capabilityId: AgentCapabilityIdV1) {
  return capabilityResult(
    capabilityId,
    'failed',
    [
      observation(
        `${capabilityId}-technical-failure`,
        'limitation',
        'failed',
        'A later authorized result could not be retrieved.',
        [],
      ),
    ],
    { error_code: 'CAPABILITY_UNAVAILABLE' },
  );
}

export function requireAllowedRun(context: AuthorizedAgentContextV1, runId: string) {
  if (!context.allowed_run_ids.includes(runId))
    throw new CapabilityRegistryError('CAPABILITY_DENIED');
}

export function legacyToolContext(
  context: RuntimeCapabilityExecutionContext,
): AgentToolExecutionContext {
  const authorized = context.authorized_context;
  return {
    ...context.turn_context,
    user_id: authorized.actor.user_id,
    role: authorized.actor.role,
    question: authorized.request.text,
    scope: authorized.scope,
    data_as_of: authorized.data_as_of,
    use_case: authorized.request.use_case,
    agent_target: authorized.request.agent_target,
    signal_action: authorized.request.signal_action,
    idempotency_key: context.idempotency_key,
    allowed_run_ids: authorized.allowed_run_ids,
    allowed_conversation_run_ids: authorized.allowed_conversation_run_ids,
    allowed_signal_refs: authorized.allowed_signal_refs,
    allowed_scopes: authorized.allowed_scopes,
  };
}

export async function visibleArtifacts(
  repository: Repository,
  context: AuthorizedAgentContextV1,
  runId: string,
  artifactIds: readonly string[],
) {
  const artifacts = await repository.publicArtifactsByIds(
    context.actor.user_id,
    context.org_id,
    runId,
    [...new Set(artifactIds)].slice(0, 12),
  );
  return artifacts.map(artifactRef);
}

export async function visibleEvidence(
  repository: Repository,
  context: AuthorizedAgentContextV1,
  runId: string,
  values: readonly { artifact_id: string; path: string }[],
) {
  const candidates = values.filter((value) =>
    context.allowed_evidence_refs.some(
      (reference) =>
        reference.run_id === runId &&
        reference.artifact_id === value.artifact_id &&
        reference.evidence_path === value.path,
    ),
  );
  const visible = await visibleArtifacts(
    repository,
    context,
    runId,
    candidates.map((candidate) => candidate.artifact_id),
  );
  const visibleIds = new Set(visible.map((artifact) => artifact.artifact_id));
  return evidenceRefs(
    runId,
    candidates.filter((candidate) => visibleIds.has(candidate.artifact_id)),
  );
}

export async function visibleMetrics(
  repository: Repository,
  context: AuthorizedAgentContextV1,
  runId: string,
  values: readonly MetricReferenceSource[],
) {
  const candidates = values.filter((value) =>
    context.allowed_evidence_refs.some(
      (reference) =>
        reference.run_id === runId &&
        reference.artifact_id === value.artifact_id &&
        reference.evidence_path === value.path,
    ),
  );
  const visible = await visibleArtifacts(
    repository,
    context,
    runId,
    candidates.map((candidate) => candidate.artifact_id),
  );
  const visibleIds = new Set(visible.map((artifact) => artifact.artifact_id));
  return metricRefs(
    runId,
    candidates.filter((candidate) => visibleIds.has(candidate.artifact_id)),
  );
}

export function groundingFromMessagePart(part: { type: string; [key: string]: unknown }) {
  if (part.type === 'run_ref')
    return [{ type: 'run', ref: { run_id: part.run_id, status: part.status } }];
  if (part.type === 'artifact_ref')
    return [
      {
        type: 'artifact',
        ref: { run_id: part.run_id, artifact_id: part.artifact_id, kind: part.kind },
      },
    ];
  if (part.type === 'claim_ref') return [{ type: 'claim', ref: part.ref }];
  if (part.type === 'metric_ref') return [{ type: 'metric', ref: part.ref }];
  if (part.type === 'evidence_ref') return [{ type: 'evidence', ref: part.ref }];
  if (part.type === 'quality_ref') return [{ type: 'quality', ref: part.ref }];
  return [];
}

import type { ArtifactOf, Metric } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { verifyArtifact } from '@vda/domain';
import type { AuthorizedAgentContextV1 } from '../context/types';
import { capabilityResult, observation, unavailable } from './projection';
import { CapabilityRegistryError } from './contracts';

/** Exact signed decimal subtraction without floating-point currency drift. */
export function metricDifference(current: number | string, previous: number | string): string | null {
  const values = [String(current), String(previous)];
  if (values.some(value => !/^-?\d+(?:\.\d+)?$/.test(value) || value.length > 60)) return null;
  const scale = Math.max(...values.map(value => value.split('.')[1]?.length ?? 0));
  const integer = (value: string) => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    return BigInt(`${whole}${fraction.padEnd(scale, '0')}`) * (negative ? -1n : 1n);
  };
  const delta = integer(values[0]!) - integer(values[1]!);
  const digits = (delta < 0 ? -delta : delta).toString().padStart(scale + 1, '0');
  const formatted = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '') : digits;
  return `${delta < 0 ? '-' : delta > 0 ? '+' : ''}${formatted}`;
}

export function explicitComparisonRuns(context: AuthorizedAgentContextV1): Set<string> {
  if (context.request?.agent_target !== 'comparison' || context.provider_context?.context_source !== 'message') return new Set();
  const references = context.provider_context.referenced_context;
  if (!Array.isArray(references)) return new Set();
  return new Set(references.flatMap((ref: unknown) => {
    if (!ref || typeof ref !== 'object' || !('type' in ref) || ref.type !== 'report' || !('id' in ref) || !('run_id' in ref)) return [];
    return context.allowed_report_refs.some(report => report.report_id === ref.id && report.run_id === ref.run_id)
      && typeof ref.run_id === 'string' ? [ref.run_id] : [];
  }));
}

export function reportMetricComparisons(left: ArtifactOf<'report'>, right: ArtifactOf<'report'>) {
  const metricRef = (artifact: ArtifactOf<'report'>, metric: Metric, index: number) => ({ type: 'metric', ref: {
    run_id: artifact.run_id, artifact_id: artifact.artifact_id, metric_key: metric.key, evidence_path: `payload.metrics[${index}].value`,
  } });
  const output = [];
  for (const [index, before] of left.payload.metrics.entries()) {
    const afterIndex = right.payload.metrics.findIndex(metric => metric.key === before.key);
    const after = right.payload.metrics[afterIndex];
    if (!after || before.status !== 'available' || after.status !== 'available' || before.value === null || after.value === null
      || before.unit !== after.unit || before.currency !== after.currency) continue;
    const difference = metricDifference(after.value, before.value);
    if (difference === null) continue;
    output.push(observation(`compare-reports-${output.length + 1}`, 'metric', 'available',
      `${before.label}: ${left.data_as_of} → ${right.data_as_of}`, [metricRef(left, before, index), metricRef(right, after, afterIndex)],
      { display_value: `${before.value} → ${after.value}; Δ ${difference} ${before.currency ?? (before.unit === 'percent' ? 'percentage points' : before.unit)}`, support_level: 'high' }));
    if (output.length === 8) break;
  }
  return output;
}

/** A pair is explicitly selected by the user; no implicit cross-report joins. */
export async function compareExplicitReports(repository: Repository, context: AuthorizedAgentContextV1) {
  const runs = explicitComparisonRuns(context);
  if (runs.size < 2) return null;
  if (runs.size !== 2) return unavailable('inspect_agent_checkpoint', 'compare-reports-select-two', 'Select exactly two reports to compare their validated metrics.');
  const selected = context.allowed_report_refs.filter(report => runs.has(report.run_id));
  if (selected.length !== 2) return unavailable('inspect_agent_checkpoint', 'compare-reports-select-two', 'Select exactly two reports to compare their validated metrics.');
  const reports = await Promise.all(selected.map(async ref => {
    const current = await repository.getReport(context.actor.user_id, context.org_id, ref.report_id);
    if (current.report.run_id !== ref.run_id) throw new CapabilityRegistryError('CAPABILITY_DENIED');
    const artifact = await repository.publicArtifactById(context.actor.user_id, context.org_id, ref.run_id, current.report.artifact_id);
    verifyArtifact(artifact);
    if (artifact.kind !== 'report') throw new CapabilityRegistryError('CAPABILITY_OUTPUT_INVALID');
    return artifact;
  }));
  const observations = reportMetricComparisons(reports[0]!, reports[1]!);
  return observations.length ? capabilityResult('inspect_agent_checkpoint', 'available', observations)
    : unavailable('inspect_agent_checkpoint', 'compare-reports-unavailable', 'The selected reports do not share available metrics with matching units and currencies.');
}

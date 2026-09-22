import {
  DEFAULT_USE_CASE,
  LIMITATION,
  USE_CASE_CONTRACT_VERSION,
  UseCaseDefinitionSchema,
  UseCaseKeySchema,
  type UseCaseDefinition,
  type DecisionUseCasePolicy,
  type UseCaseKey,
} from '@vda/contracts';

/**
 * Server-owned workflow registry.  Definitions are code-reviewed and expose
 * capabilities only; neither a client nor a model can add query templates or
 * analytics semantics through this boundary.
 */
const slowMovingInventory = UseCaseDefinitionSchema.parse({
  contract_version: USE_CASE_CONTRACT_VERSION,
  key: 'slow_moving_inventory',
  version: 'slow-moving-inventory-v2',
  display_name: 'Slow-moving inventory',
  scope_policy: { project_required: true, zone_optional: true },
  comparison_windows_days: [7, 30, 90],
  required_fields: [
    'snapshot_date',
    'project_external_id',
    'zone_external_id',
    'unit_external_id',
    'unit_type',
    'bedrooms',
    'status',
    'available_since',
    'list_price',
    'area_sqm',
    'currency',
    'import_id',
  ],
  supported_dimensions: ['project', 'zone', 'unit_type', 'bedrooms', 'status'],
  capabilities: ['analysis', 'comparison', 'chart', 'analyst_follow_up', 'report_revision'],
  provisional_limitation: LIMITATION,
  decision_policy: {
    version: 'slow-moving-inventory-decision-policy-v1',
    materiality: [
      {
        rule_id: 'inventory-relative-v1',
        metric_key: 'available_inventory',
        delta_kind: 'relative_pct',
        watch_threshold: 10,
        material_threshold: 20,
        direction: 'higher_is_worse',
        comparability_required: true,
      },
      {
        rule_id: 'slow-moving-count-relative-v1',
        metric_key: 'slow_moving_units',
        delta_kind: 'relative_pct',
        watch_threshold: 10,
        material_threshold: 20,
        direction: 'higher_is_worse',
        comparability_required: true,
      },
      {
        rule_id: 'slow-moving-rate-points-v1',
        metric_key: 'slow_moving_rate',
        delta_kind: 'percentage_points',
        watch_threshold: 5,
        material_threshold: 10,
        direction: 'higher_is_worse',
        comparability_required: true,
      },
      {
        rule_id: 'inventory-age-relative-v1',
        metric_key: 'median_inventory_age_days',
        delta_kind: 'relative_pct',
        watch_threshold: 10,
        material_threshold: 20,
        direction: 'higher_is_worse',
        comparability_required: true,
      },
      {
        rule_id: 'price-relative-context-v1',
        metric_key: 'median_price',
        delta_kind: 'relative_pct',
        watch_threshold: 10,
        material_threshold: 20,
        direction: 'context_only',
        comparability_required: true,
      },
    ],
    priority: {
      entity_types: ['unit', 'zone', 'unit_type'],
      max_units: 5,
      max_segments: 3,
      max_total: 11,
      tie_breakers: ['entity_type', 'entity_key'],
    },
    actions: [
      {
        rule_id: 'inspect-ranked-entity-v1',
        kind: 'inspect_entities',
        min_support: 'high',
        target_entity_types: ['unit', 'zone', 'unit_type'],
        label_template_id: 'inspect-ranked-entity-v1',
        rationale_template_id: 'inspect-ranked-entity-rationale-v1',
      },
      {
        rule_id: 'compare-ranked-segment-v1',
        kind: 'compare_segments',
        min_support: 'high',
        target_entity_types: ['zone', 'unit_type'],
        label_template_id: 'compare-ranked-segment-v1',
        rationale_template_id: 'compare-ranked-segment-rationale-v1',
      },
      {
        rule_id: 'review-supported-price-v1',
        kind: 'review_pricing',
        min_support: 'medium',
        target_entity_types: ['unit'],
        label_template_id: 'review-supported-price-v1',
        rationale_template_id: 'review-supported-price-rationale-v1',
      },
      {
        rule_id: 'open-decision-evidence-v1',
        kind: 'navigate_to_evidence',
        min_support: 'high',
        target_entity_types: [],
        label_template_id: 'open-decision-evidence-v1',
        rationale_template_id: 'open-decision-evidence-rationale-v1',
      },
    ],
    visualization: {
      preferred_intents: [
        'inventory_kpi',
        'inventory_trend',
        'slow_moving_by_segment',
        'inventory_composition',
        'aging_distribution',
        'peer_comparison',
      ],
      primary_cap: 3,
      comparison_required_intents: ['inventory_trend'],
    },
    audience: {
      audience_key: 'sales_operations',
      decision_horizon: 'current inventory review',
      terminology: 'concise_operational',
      visible_limitations_required: true,
    },
  },
});

const registry: ReadonlyMap<UseCaseKey, UseCaseDefinition> = new Map([
  [slowMovingInventory.key, slowMovingInventory],
]);
const versionedRegistry: ReadonlyMap<string, UseCaseDefinition> = new Map(
  [...registry.values()].map((definition) => [`${definition.key}:${definition.version}`, definition]),
);

export const useCases: readonly UseCaseDefinition[] = Object.freeze([...registry.values()]);

export class UnknownUseCaseError extends Error {
  readonly code = 'UNKNOWN_USE_CASE';
  constructor(value: unknown) {
    super(`UNKNOWN_USE_CASE:${typeof value === 'string' ? value : 'invalid'}`);
  }
}

export function getUseCaseDefinition(
  value: string | null | undefined,
  version?: string,
): UseCaseDefinition {
  const key = value ?? DEFAULT_USE_CASE;
  const parsed = UseCaseKeySchema.safeParse(key);
  if (!parsed.success) throw new UnknownUseCaseError(value);
  if (version) {
    const definition = versionedRegistry.get(`${parsed.data}:${version}`);
    if (!definition) throw new UnknownUseCaseError(`${parsed.data}:${version}`);
    return definition;
  }
  const definition = registry.get(parsed.data);
  if (!definition) throw new UnknownUseCaseError(value);
  return definition;
}

export function supportsUseCaseCapability(
  definition: UseCaseDefinition,
  capability: UseCaseDefinition['capabilities'][number],
): boolean {
  return definition.capabilities.includes(capability);
}

/** Returns only a pinned, server-owned v2 policy; clients and providers cannot supply one. */
export function getDecisionUseCasePolicy(
  value: string | null | undefined,
  version?: string,
): DecisionUseCasePolicy {
  const definition = getUseCaseDefinition(value, version);
  if (!definition.decision_policy) throw new UnknownUseCaseError(value);
  return definition.decision_policy;
}

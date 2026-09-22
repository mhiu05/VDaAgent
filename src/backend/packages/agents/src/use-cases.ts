import {
  DEFAULT_USE_CASE,
  LIMITATION,
  UseCaseDefinitionSchema,
  UseCaseKeySchema,
  type UseCaseDefinition,
  type UseCaseKey,
} from '@vda/contracts';

/**
 * Server-owned workflow registry.  Definitions are code-reviewed and expose
 * capabilities only; neither a client nor a model can add query templates or
 * analytics semantics through this boundary.
 */
const slowMovingInventory = UseCaseDefinitionSchema.parse({
  contract_version: 'use-case-v1',
  key: 'slow_moving_inventory',
  version: 'slow-moving-inventory-v1',
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
});

const registry: ReadonlyMap<UseCaseKey, UseCaseDefinition> = new Map([
  [slowMovingInventory.key, slowMovingInventory],
]);

export const useCases: readonly UseCaseDefinition[] = Object.freeze([...registry.values()]);

export class UnknownUseCaseError extends Error {
  readonly code = 'UNKNOWN_USE_CASE';
  constructor(value: unknown) {
    super(`UNKNOWN_USE_CASE:${typeof value === 'string' ? value : 'invalid'}`);
  }
}

export function getUseCaseDefinition(value: string | null | undefined): UseCaseDefinition {
  const key = value ?? DEFAULT_USE_CASE;
  const parsed = UseCaseKeySchema.safeParse(key);
  if (!parsed.success) throw new UnknownUseCaseError(value);
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

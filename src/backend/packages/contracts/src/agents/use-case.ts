import { z } from 'zod';
import { MetricKeySchema } from '../analysis/metrics';
import { DecisionActionKindSchema, PriorityEntityTypeSchema } from '../decision/intelligence';
import { ChartIntentSchema } from '../analysis/chart';
import { USE_CASE_CONTRACT_VERSION, UseCaseKeySchema } from '../common/primitives';

// Agent-workflow contracts are deliberately separate from the legacy artifact
// union below.  Phase A only establishes typed boundaries; writers are added
// behind the agent workflow version after persistence support is available.
export const UseCaseCapabilitySchema = z.enum([
  'analysis',
  'comparison',
  'chart',
  'analyst_follow_up',
  'report_revision',
]);
export type UseCaseCapability = z.infer<typeof UseCaseCapabilitySchema>;
export const DecisionMaterialityRuleSchema = z
  .object({
    rule_id: z.string().trim().min(1).max(160),
    metric_key: MetricKeySchema,
    delta_kind: z.enum(['relative_pct', 'percentage_points']),
    watch_threshold: z.number().positive(),
    material_threshold: z.number().positive(),
    direction: z.enum(['higher_is_worse', 'higher_is_better', 'context_only']),
    comparability_required: z.literal(true),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.material_threshold < rule.watch_threshold)
      ctx.addIssue({
        code: 'custom',
        path: ['material_threshold'],
        message: 'Material threshold must be at least the watch threshold',
      });
  });
export type DecisionMaterialityRule = z.infer<typeof DecisionMaterialityRuleSchema>;
export const DecisionPriorityPolicySchema = z
  .object({
    entity_types: z.array(PriorityEntityTypeSchema).min(1).max(6),
    max_units: z.number().int().min(1).max(20),
    max_segments: z.number().int().min(1).max(20),
    max_total: z.number().int().min(1).max(40),
    tie_breakers: z
      .array(z.enum(['entity_type', 'entity_key']))
      .min(1)
      .max(2),
  })
  .strict();
export type DecisionPriorityPolicy = z.infer<typeof DecisionPriorityPolicySchema>;
export const DecisionActionPolicySchema = z
  .object({
    rule_id: z.string().trim().min(1).max(160),
    kind: DecisionActionKindSchema,
    min_support: z.enum(['high', 'medium', 'exploratory']),
    target_entity_types: z.array(PriorityEntityTypeSchema).max(6),
    label_template_id: z.string().trim().min(1).max(160),
    rationale_template_id: z.string().trim().min(1).max(160),
  })
  .strict();
export type DecisionActionPolicy = z.infer<typeof DecisionActionPolicySchema>;
export const DecisionVisualizationPolicySchema = z
  .object({
    preferred_intents: z.array(ChartIntentSchema).min(1).max(8),
    primary_cap: z.number().int().min(1).max(3),
    comparison_required_intents: z.array(ChartIntentSchema).max(8),
  })
  .strict();
export type DecisionVisualizationPolicy = z.infer<typeof DecisionVisualizationPolicySchema>;
export const DecisionAudienceProfileSchema = z
  .object({
    audience_key: z.literal('sales_operations'),
    decision_horizon: z.string().trim().min(1).max(160),
    terminology: z.enum(['concise_operational']),
    visible_limitations_required: z.literal(true),
  })
  .strict();
export type DecisionAudienceProfile = z.infer<typeof DecisionAudienceProfileSchema>;
export const DecisionUseCasePolicySchema = z
  .object({
    version: z.string().trim().min(1).max(100),
    materiality: z.array(DecisionMaterialityRuleSchema).min(1).max(30),
    priority: DecisionPriorityPolicySchema,
    actions: z.array(DecisionActionPolicySchema).min(1).max(20),
    visualization: DecisionVisualizationPolicySchema,
    audience: DecisionAudienceProfileSchema,
  })
  .strict();
export type DecisionUseCasePolicy = z.infer<typeof DecisionUseCasePolicySchema>;
export const UseCaseDefinitionSchema = z
  .object({
    contract_version: z.union([z.literal('use-case-v1'), z.literal(USE_CASE_CONTRACT_VERSION)]),
    key: UseCaseKeySchema,
    version: z.string().trim().min(1).max(100),
    display_name: z.string().trim().min(1).max(200),
    scope_policy: z
      .object({ project_required: z.literal(true), zone_optional: z.literal(true) })
      .strict(),
    comparison_windows_days: z
      .array(z.union([z.literal(7), z.literal(30), z.literal(90)]))
      .min(1)
      .max(3),
    required_fields: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
    supported_dimensions: z
      .array(z.enum(['project', 'zone', 'unit_type', 'bedrooms', 'status']))
      .min(1)
      .max(10),
    capabilities: z.array(UseCaseCapabilitySchema).min(1).max(10),
    provisional_limitation: z.string().trim().min(1).max(2_000),
    /** Required for v2 registry entries; absent historical definitions remain parseable. */
    decision_policy: DecisionUseCasePolicySchema.optional(),
  })
  .strict()
  .superRefine((definition, ctx) => {
    if (definition.contract_version === USE_CASE_CONTRACT_VERSION && !definition.decision_policy)
      ctx.addIssue({
        code: 'custom',
        path: ['decision_policy'],
        message: 'A v2 use-case definition requires a decision policy',
      });
  });
export type UseCaseDefinition = z.infer<typeof UseCaseDefinitionSchema>;

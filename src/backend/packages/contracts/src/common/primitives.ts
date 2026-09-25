import { z } from 'zod';

export const SEMANTIC_VERSION = 'mvp-inventory-v0.2' as const;
export const ARTIFACT_SCHEMA_VERSION = '1.1' as const;
/**
 * The agent workflow is intentionally registered in code.  This is not a
 * user-provided prompt or a free-form analytics selector.
 */
export const DEFAULT_USE_CASE = 'slow_moving_inventory' as const;
export const USE_CASE_CONTRACT_VERSION = 'use-case-v2' as const;
export const UseCaseKeySchema = z.enum([DEFAULT_USE_CASE]);
export type UseCaseKey = z.infer<typeof UseCaseKeySchema>;
export const WorkflowVersionSchema = z.enum(['legacy-v1', 'agent-v1']);
export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;
export const AgentKeySchema = z.enum([
  'coordinator',
  'data',
  'comparison',
  'chart',
  'analyst',
  'insight',
  'report',
  'reviewer',
]);
export type AgentKey = z.infer<typeof AgentKeySchema>;
export const resolveUseCase = (value: { use_case?: UseCaseKey | null }): UseCaseKey =>
  value.use_case ?? DEFAULT_USE_CASE;
export const LIMITATION =
  'Assumption / MVP provisional — dữ liệu tổng hợp và công thức synthetic, chưa được BA/Data Owner phê duyệt.';
export const IdSchema = z.uuid();
export const DateSchema = z.iso.date();
export const TimestampSchema = z.iso.datetime({ offset: true });
export const DecimalSchema = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/)
  .max(40);
export const SignedDecimalSchema = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .max(40);
export const RoleSchema = z.enum(['owner', 'analyst', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;
export const ScopeSchema = z
  .object({
    project_external_id: z.string().min(1).max(100),
    zone_external_id: z.string().min(1).max(100).nullable().default(null),
  })
  .strict();
export type Scope = z.infer<typeof ScopeSchema>;
export const CursorSchema = z.string().min(1).max(500);

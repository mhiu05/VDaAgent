import { z } from 'zod';
import {
  AgentKeySchema,
  DEFAULT_USE_CASE,
  DateSchema,
  IdSchema,
  ScopeSchema,
  UseCaseKeySchema,
} from '../common/primitives';

export const AnalysisRequestSchema = z
  .object({
    org_id: IdSchema,
    scope: ScopeSchema,
    data_as_of: DateSchema,
    question: z.string().trim().min(1).max(2000),
    conversation_id: IdSchema.nullable().default(null),
    use_case: UseCaseKeySchema.default(DEFAULT_USE_CASE),
    /** Captures an explicit bounded specialist request on newly created runs. */
    agent_target: AgentKeySchema.nullable().default(null),
  })
  .strict();
/** Input remains compatible with callers that predate the use-case field. */
export type AnalysisRequest = z.input<typeof AnalysisRequestSchema>;
export type ResolvedAnalysisRequest = z.output<typeof AnalysisRequestSchema>;

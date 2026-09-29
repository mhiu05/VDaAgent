import { z } from 'zod';
import { MetricKeySchema } from '../analysis/metrics';
import { UseCaseKeySchema } from '../common/primitives';

/** Server-owned business workflow requirements; agent programs remain reusable. */
export const SkillDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{2,79}$/),
    version: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(500),
    use_case: UseCaseKeySchema,
    supported_intents: z.array(z.enum(['interactive_analysis', 'scheduled_report'])).min(1),
    required_metrics: z.array(MetricKeySchema).min(1),
    required_artifacts: z
      .array(
        z.enum([
          'data_analysis_pack',
          'comparison_pack',
          'analysis_pack',
          'insight_pack',
          'report_draft',
          'review_result',
        ]),
      )
      .min(1),
    evidence_policy: z.object({ require_report_refs: z.boolean() }).strict(),
    report_policy: z.object({ require_review_pass: z.boolean() }).strict(),
  })
  .strict();
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

import { z } from 'zod';
import {
  DEFAULT_USE_CASE,
  IdSchema,
  ScopeSchema,
  TimestampSchema,
  UseCaseKeySchema,
} from '../common/primitives';

export const ReportDefinitionInputSchema = z
  .object({
    org_id: IdSchema,
    name: z.string().trim().min(1).max(200),
    scope: ScopeSchema,
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid IANA timezone'),
    local_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    data_as_of_policy: z.enum(['scheduled_date', 'previous_day']).default('scheduled_date'),
    enabled: z.boolean().default(true),
    use_case: UseCaseKeySchema.default(DEFAULT_USE_CASE),
  })
  .strict();
export const ReportDefinitionSchema = ReportDefinitionInputSchema.extend({
  report_definition_id: IdSchema,
  definition_version: z.number().int().positive(),
  created_by: IdSchema,
  created_at: TimestampSchema,
  next_run_at: TimestampSchema,
});
export type ReportDefinitionInput = z.input<typeof ReportDefinitionInputSchema>;
export type ResolvedReportDefinitionInput = z.output<typeof ReportDefinitionInputSchema>;
export type ReportDefinition = z.infer<typeof ReportDefinitionSchema>;
export const ReportOccurrenceSchema = z.object({
  occurrence_id: IdSchema,
  org_id: IdSchema,
  report_definition_id: IdSchema,
  definition_version: z.number().int().positive(),
  definition_snapshot: ReportDefinitionSchema,
  scheduled_for: TimestampSchema,
  run_id: IdSchema,
  created_at: TimestampSchema,
});
export type ReportOccurrence = z.infer<typeof ReportOccurrenceSchema>;

import { z } from 'zod';
import { ClaimSchema } from '../analysis/chart';
import { MetricSchema } from '../analysis/metrics';
import { CalculatedUnitSchema } from '../analysis/calculation';
import { IdSchema, TimestampSchema } from '../common/primitives';
import { ReportSectionSchema } from './section';
import { DecisionBriefSchema } from '../decision/brief';

export const ReportPayloadSchema = z.object({
  title: z.string(),
  summary: z.string(),
  claims: z.array(ClaimSchema),
  metrics: z.array(MetricSchema),
  units: z.array(CalculatedUnitSchema),
  calculation_artifact_id: IdSchema,
  chart_artifact_id: IdSchema,
  comparison_artifact_id: IdSchema,
  sections: z.array(ReportSectionSchema),
  limitations: z.array(z.string()),
  decision_brief: DecisionBriefSchema.optional(),
  /** Canonical v2 pack for new runs; the embedded v1 brief remains a compatibility projection. */
  decision_intelligence_artifact_id: IdSchema.optional(),
});
export type ReportPayload = z.infer<typeof ReportPayloadSchema>;
export const ReportRecordSchema = z.object({
  report_id: IdSchema,
  org_id: IdSchema,
  run_id: IdSchema,
  artifact_id: IdSchema,
  created_at: TimestampSchema,
  occurrence_id: IdSchema.nullable(),
});
export type ReportRecord = z.infer<typeof ReportRecordSchema>;

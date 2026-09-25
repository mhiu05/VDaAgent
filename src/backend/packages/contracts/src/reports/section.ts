import { z } from 'zod';
import { IdSchema } from '../common/primitives';
import { MetricKeySchema } from '../analysis/metrics';

export const ReportSectionSchema = z.object({
  key: z.enum([
    'executive_summary',
    'inventory_overview',
    'trend',
    'aging_analysis',
    'price_analysis',
    'segment_analysis',
    'comparison',
    'data_quality_limitations',
    'evidence_lineage',
  ]),
  title: z.string(),
  artifact_refs: z.array(IdSchema),
  metric_keys: z.array(MetricKeySchema),
  status: z.enum(['available', 'limited', 'unavailable']),
  limitations: z.array(z.string()),
});
export type ReportSection = z.infer<typeof ReportSectionSchema>;

import { z } from 'zod';
import { DateSchema, DecimalSchema, IdSchema, TimestampSchema } from '../common/primitives';

export const CSV_COLUMNS = [
  'snapshot_date',
  'market_external_id',
  'market_name',
  'project_external_id',
  'project_name',
  'zone_external_id',
  'zone_name',
  'unit_external_id',
  'unit_code',
  'unit_type',
  'area_sqm',
  'list_price',
  'currency',
  'status',
  'available_since',
  'sold_at',
] as const;
const ExternalId = z.string().trim().min(1).max(100);
export const SnapshotRowSchema = z
  .object({
    snapshot_date: DateSchema,
    market_external_id: ExternalId,
    market_name: z.string().min(1).max(200),
    project_external_id: ExternalId,
    project_name: z.string().min(1).max(200),
    zone_external_id: ExternalId,
    zone_name: z.string().min(1).max(200),
    unit_external_id: ExternalId,
    unit_code: z.string().min(1).max(100),
    unit_type: ExternalId,
    area_sqm: DecimalSchema.nullable(),
    list_price: DecimalSchema.nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.enum(['available', 'reserved', 'sold', 'held', 'unknown']),
    available_since: DateSchema.nullable(),
    sold_at: DateSchema.nullable(),
    bedrooms: z.number().int().nonnegative().nullable().default(null),
  })
  .strict()
  .superRefine((row, ctx) => {
    for (const key of ['available_since', 'sold_at'] as const) {
      if (row[key] && row[key] > row.snapshot_date)
        ctx.addIssue({ code: 'custom', path: [key], message: 'Date cannot follow snapshot_date' });
    }
  });
export type SnapshotRow = z.infer<typeof SnapshotRowSchema>;
export const UnitSnapshotSchema = SnapshotRowSchema.safeExtend({
  org_id: IdSchema,
  snapshot_id: IdSchema,
  import_id: IdSchema,
});
export type UnitSnapshot = z.infer<typeof UnitSnapshotSchema>;
export const ImportManifestSchema = z.object({
  import_id: IdSchema,
  org_id: IdSchema,
  created_by: IdSchema,
  created_at: TimestampSchema,
  source_name: z.string(),
  file_hash: z.string().regex(/^[a-f0-9]{64}$/),
  row_count: z.number().int().nonnegative(),
  storage_path: z.string().nullable(),
  schema_version: z.literal('csv-v1'),
  provisional: z.literal(true),
});
export type ImportManifest = z.infer<typeof ImportManifestSchema>;
export const ImportRequestSchema = z
  .object({
    org_id: IdSchema,
    source_name: z.string().min(1).max(200),
    csv: z.string().min(1).max(2_000_000),
  })
  .strict();

import type { ArtifactOf } from '@vda/contracts';
import { verifyArtifact } from '@vda/domain';

function csvCell(value: string | number | boolean | null): string {
  const raw = value === null ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function exportReport(
  artifact: ArtifactOf<'report'>,
  format: 'json' | 'csv',
): { body: string; contentType: string } {
  verifyArtifact(artifact);
  if (format === 'json')
    return {
      body: JSON.stringify(artifact, null, 2),
      contentType: 'application/json; charset=utf-8',
    };
  const rows: (string | number | boolean | null)[][] = [
    ['artifact_id', artifact.artifact_id],
    ['content_hash', artifact.content_hash],
    ['semantic_version', artifact.semantic_version],
    ['provisional', artifact.provisional],
    ['data_as_of', artifact.data_as_of],
    ['metric_id', 'label', 'value', 'unit', 'currency', 'evidence_artifact_id'],
    ...artifact.payload.metrics.map((m) => [
      m.metric_id,
      m.label,
      m.value,
      m.unit,
      m.currency,
      artifact.payload.calculation_artifact_id,
    ]),
    [],
    [
      'unit_external_id',
      'unit_code',
      'status',
      'age_days',
      'slow_moving',
      'list_price',
      'price_per_sqm',
      'currency',
      'snapshot_id',
      'import_id',
    ],
    ...artifact.payload.units.map((u) => [
      u.unit_external_id,
      u.unit_code,
      u.status,
      u.age_days,
      u.slow_moving,
      u.list_price,
      u.price_per_sqm,
      u.currency,
      u.snapshot_id,
      u.import_id,
    ]),
  ];
  return {
    body: '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n'),
    contentType: 'text/csv; charset=utf-8',
  };
}

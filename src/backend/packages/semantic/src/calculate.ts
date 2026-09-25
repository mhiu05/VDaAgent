import { analyze } from './analyze';
import type { UnitSnapshot } from '@vda/contracts/imports/inventory';
import type { CalculationPayload } from '@vda/contracts/analysis/calculation';

export function calculate(rows: UnitSnapshot[], asOf: string, threshold = 90): CalculationPayload {
  const orgId = rows[0]?.org_id ?? '00000000-0000-0000-0000-000000000000';
  const project = rows[0]?.project_external_id ?? 'unavailable';
  return analyze(
    rows,
    orgId,
    { project_external_id: project, zone_external_id: null },
    asOf,
    threshold,
  );
}

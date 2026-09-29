import { RunSchema, type AnalysisRun, type WorkflowVersion } from '@vda/contracts';
import type { Row } from '../driver';
import { json } from './rows';

export const LEGACY_WORKFLOW_VERSION: WorkflowVersion = 'legacy-v1';

export function normalizeRun(row: Row): AnalysisRun {
  const run = RunSchema.parse(json(row));
  return { ...run, workflow_version: run.workflow_version ?? LEGACY_WORKFLOW_VERSION };
}

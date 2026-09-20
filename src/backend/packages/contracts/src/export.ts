import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  AnalysisRequestSchema,
  ArtifactSchema,
  ReportDefinitionSchema,
  RunSchema,
  SnapshotRowSchema,
} from './index';
await mkdir('src/backend/packages/contracts/schema', { recursive: true });
for (const [name, schema] of Object.entries({
  AnalysisRequest: AnalysisRequestSchema,
  Artifact: ArtifactSchema,
  ReportDefinition: ReportDefinitionSchema,
  Run: RunSchema,
  SnapshotRow: SnapshotRowSchema,
})) {
  await writeFile(
    `src/backend/packages/contracts/schema/${name}.json`,
    `${JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any' }), null, 2)}\n`,
  );
}

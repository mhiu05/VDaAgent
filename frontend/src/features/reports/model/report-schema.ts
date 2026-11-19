import type { ReportScope } from "./types";
import type { ChartSpec } from "../../../shared/charts/chart-contract";

export interface ReportTypeMetadata {
  id: string;
  name: string;
  description?: string;
  category?: string;
}
interface BlockBase {
  id: string;
  title: string;
  description?: string;
  evidenceIds: readonly string[];
  span?: "full" | "half";
}
export type SchemaBlock = BlockBase &
  (
    | {
        kind: "metric-grid";
        metrics: readonly {
          id: string;
          label: string;
          value: number | null;
          unit: string;
          definition?: string;
          comparison?: string;
        }[];
      }
    | { kind: "chart"; chart: ChartSpec }
    | {
        kind: "data-table" | "comparison";
        columns: readonly string[];
        rows: readonly (readonly (string | number | null)[])[];
        unit: string;
      }
    | { kind: "text"; markdown: string }
    | { kind: "finding" | "recommendation"; text: string }
    | { kind: "evidence"; references: readonly string[] }
    | { kind: "section"; blocks: readonly SchemaBlock[] }
    | { kind: "unsupported"; originalKind: string; message: string }
  );
/** Identity belongs to the saved version, never to a live dashboard query. */
export interface ReportSchema {
  schemaVersion: 1;
  reportId: string;
  versionId: string;
  reportTypeId: string;
  title: string;
  language?: string;
  description?: string;
  domain?: string;
  skill?: { id: string; name: string; revision: string };
  scope?: ReportScope;
  summary?: string;
  limitations: readonly string[];
  dashboard: readonly SchemaBlock[];
  sections: readonly SchemaBlock[];
  diagnostics: readonly string[];
}

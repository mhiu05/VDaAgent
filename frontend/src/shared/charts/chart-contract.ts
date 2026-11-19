export type ChartType =
  | "line"
  | "area"
  | "bar"
  | "column"
  | "grouped-bar"
  | "stacked-bar"
  | "pie"
  | "donut"
  | "scatter"
  | "heatmap"
  | "histogram";
export interface ChartSpec {
  id: string;
  type?: string;
  title: string;
  description?: string;
  dimension: {
    label: string;
    kind: "categorical" | "temporal" | "numeric";
    unit?: string;
  };
  labels: readonly (string | number)[];
  series: readonly {
    id: string;
    label: string;
    unit: string;
    values: readonly (number | null)[];
  }[];
  semantic?:
    | "comparison"
    | "trend"
    | "composition"
    | "relationship"
    | "matrix"
    | "distribution";
  /** Explicit bin edges for pre-aggregated distributions; values are frequencies. */
  binEnds?: readonly number[];
  sourceId: string;
  evidenceIds?: readonly string[];
}

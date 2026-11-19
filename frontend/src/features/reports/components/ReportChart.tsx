import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatDate } from "../../../shared/lib/format";
import { useMemo } from "react";
import type { ChartSpec } from "../../../shared/charts/chart-contract";
import {
  ChartRenderer,
  type ChartPresentation,
} from "../../../shared/charts/ChartRenderer";
import type { ReportSummaryChart } from "../model/version-summary";

/** Legacy saved charts use the same foundation without rewriting their snapshots. */
export function ReportChart({
  chart,
  dataThrough,
  presentation = "reading",
}: {
  chart: ReportSummaryChart;
  dataThrough: string;
  presentation?: ChartPresentation;
}) {
  const { preferences } = usePreferences();
  const spec = useMemo<ChartSpec>(
    () => ({
      id: chart.id,
      type: chart.chartType ?? "bar",
      title: chart.title,
      description: chart.question,
      dimension: { label: chart.title, kind: "categorical" },
      labels: chart.labels,
      series: [
        {
          id: chart.id,
          label: chart.title,
          unit: chart.unit,
          values: chart.values,
        },
      ],
      sourceId: chart.sourceId,
    }),
    [chart],
  );
  return (
    <ChartRenderer
      spec={spec}
      scope={formatDate(dataThrough, preferences.locale, preferences.timezone)}
      presentation={presentation}
    />
  );
}

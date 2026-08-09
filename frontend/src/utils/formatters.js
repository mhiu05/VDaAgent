export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function formatPercent(value) {
  if (value === undefined || value === null) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatNumber(value) {
  if (value === undefined || value === null) return "-";
  return Number(value).toPrecision(4);
}

export function sectionsToResult(sectionsResult) {
  if (!sectionsResult) return null;
  return {
    source: { name: sectionsResult.source_name, type: sectionsResult.source_type },
    dataset_summary: {
      row_count: "-",
      column_count: sectionsResult.sections?.schema?.length || sectionsResult.sections?.columns?.length || "-",
    },
    columns: sectionsResult.sections?.columns || [],
    findings: sectionsResult.sections?.findings || [],
    quality_summary: sectionsResult.sections?.quality_summary || {},
    relationships: {
      correlations: sectionsResult.sections?.correlations || [],
      inferred_relationships: sectionsResult.sections?.relationships?.inferred_relationships || [],
    },
  };
}

export function createHistoryEntry(result) {
  return {
    id: crypto.randomUUID(),
    sourceName: result?.source?.name || result?.source_name || "unknown",
    rowCount: result?.dataset_summary?.row_count ?? "-",
    columnCount: result?.dataset_summary?.column_count ?? "-",
    generatedAt: new Date().toISOString(),
  };
}

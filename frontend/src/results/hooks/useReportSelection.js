import { useEffect, useMemo, useState } from "react";
import { getSourceName } from "../utils/reportMetrics.js";

const STORAGE_KEY = "profiling-agent.reportState";

export function useReportSelection(result, resultSources, selectedProfileIndex, setSelectedProfileIndex) {
  const [state, setState] = useState(() => readState());
  const sources = resultSources?.length ? resultSources : result ? [result] : [];
  const safeIndex = sources[selectedProfileIndex] ? selectedProfileIndex : 0;
  const activeResult = sources[safeIndex] || result || null;
  const datasetKey = getSourceName(activeResult);
  const datasetState = state[datasetKey] || {};

  useEffect(() => {
    writeState(state);
  }, [state]);

  function updateDatasetState(patch) {
    setState((current) => ({
      ...current,
      [datasetKey]: {
        ...(current[datasetKey] || {}),
        ...patch,
      },
    }));
  }

  return {
    sources,
    safeIndex,
    activeResult,
    datasetKey,
    selectedColumnName: datasetState.selectedColumnName || "",
    setSelectedColumnName: (selectedColumnName) => updateDatasetState({ selectedColumnName }),
    filters: datasetState.filters || DEFAULT_FILTERS,
    setFilters: (filters) => updateDatasetState({ filters }),
    sort: datasetState.sort || DEFAULT_SORT,
    setSort: (sort) => updateDatasetState({ sort }),
    correlationView: datasetState.correlationView || "matrix",
    setCorrelationView: (correlationView) => updateDatasetState({ correlationView }),
    selectedProfileIndex: safeIndex,
    setSelectedProfileIndex,
  };
}

export function useFilteredColumns(columns, findingsByColumn, filters, sort) {
  return useMemo(() => {
    const search = String(filters.search || "").trim().toLowerCase();
    const dataType = filters.dataType || "all";
    const severity = filters.severity || "all";

    const filtered = (columns || []).filter((column) => {
      const nameMatch = !search || column.name.toLowerCase().includes(search);
      const typeMatch = dataType === "all" || column.data_type === dataType;
      const findings = findingsByColumn.get(column.name) || [];
      const severityMatch = severity === "all"
        || (severity === "ok" ? !findings.length : findings.some((finding) => finding.severity === severity));
      return nameMatch && typeMatch && severityMatch;
    });

    return filtered.sort((left, right) => {
      const direction = sort.direction === "asc" ? 1 : -1;
      const leftValue = sortableValue(left, sort.key);
      const rightValue = sortableValue(right, sort.key);
      if (leftValue < rightValue) return -1 * direction;
      if (leftValue > rightValue) return 1 * direction;
      return left.name.localeCompare(right.name);
    });
  }, [columns, findingsByColumn, filters, sort]);
}

function sortableValue(column, key) {
  if (key === "null_ratio" || key === "distinct_ratio" || key === "distinct_count" || key === "avg" || key === "median") {
    return Number(column[key] ?? -Infinity);
  }
  return String(column[key] ?? column.name ?? "");
}

function readState() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeState(state) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Report UI state is best-effort only.
  }
}

const DEFAULT_FILTERS = { search: "", dataType: "all", severity: "all" };
const DEFAULT_SORT = { key: "name", direction: "asc" };

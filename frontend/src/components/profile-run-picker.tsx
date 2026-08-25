"use client";

import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getProfile, listDatasets, listRuns } from "@/lib/api";
import type { ProfileRunSummary } from "@/lib/types";

type ProfileRunPickerProps = {
  id: string;
  label: string;
  value: string;
  onChange: (runId: string) => void;
  helpText?: string;
  excludeRunId?: string;
  disabled?: boolean;
};

export function profileRunLabel(run: Pick<ProfileRunSummary, "run_name" | "version">): string {
  return run.run_name?.trim() || `Phiên bản v${run.version ?? "—"}`;
}

export function profileRunMeta(run: Pick<ProfileRunSummary, "version" | "scan_mode" | "row_count" | "created_at">): string {
  const scan = run.scan_mode === "full" ? "Full scan" : run.scan_mode === "sample" ? "Sample scan" : "Chưa rõ scan";
  const rows = run.row_count === null || run.row_count === undefined ? "— dòng" : `${run.row_count.toLocaleString("vi-VN")} dòng`;
  const created = run.created_at ? new Date(run.created_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : null;
  return [`v${run.version ?? "—"}`, scan, rows, created].filter(Boolean).join(" · ");
}

export function profileRunOptionLabel(run: ProfileRunSummary): string {
  return `${profileRunLabel(run)} · ${profileRunMeta(run)}`;
}

export function ProfileRunPicker({ id, label, value, onChange, helpText, excludeRunId, disabled = false }: ProfileRunPickerProps) {
  const [datasetId, setDatasetId] = useState("");
  // Reuse the dataset/run caches used by the Dataset screens and chat widget.
  // Navigation to Charts is then instant when this metadata was fetched recently.
  const datasets = useQuery({
    queryKey: ["datasets"],
    queryFn: ({ signal }) => listDatasets(signal),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
  const selectedProfile = useQuery({
    // Share the exact cache entry used by Profile Run and Charts pages. This
    // keeps the selector from fetching the same profile a second time.
    queryKey: ["profile", value],
    queryFn: ({ signal }) => getProfile(value, signal),
    enabled: Boolean(value) && !datasetId,
    retry: false,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
  const runs = useQuery({
    queryKey: ["runs", datasetId],
    queryFn: ({ signal }) => listRuns(datasetId, signal),
    enabled: Boolean(datasetId),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  useEffect(() => {
    if (selectedProfile.data?.dataset_id) setDatasetId(selectedProfile.data.dataset_id);
  }, [selectedProfile.data?.dataset_id]);

  return <div className="profile-run-picker">
    <label className="profile-run-picker-label" htmlFor={`${id}-dataset`}>{label}</label>
    {helpText && <small className="hint">{helpText}</small>}
    <div className="profile-run-picker-controls">
      <select id={`${id}-dataset`} value={datasetId} onChange={(event) => { setDatasetId(event.target.value); onChange(""); }} disabled={disabled || datasets.isPending}>
        <option value="">Chọn bộ dữ liệu…</option>
        {datasets.data?.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>)}
      </select>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || !datasetId || runs.isPending}>
        <option value="">Chọn phiên profiling đã hoàn tất…</option>
        {runs.data?.filter((run) => run.status === "completed" && run.id !== excludeRunId).map((run) => <option value={run.id} key={run.id}>{profileRunOptionLabel(run)}</option>)}
      </select>
    </div>
    {datasetId && !runs.isPending && !runs.data?.some((run) => run.status === "completed" && run.id !== excludeRunId) && <small className="hint">Bộ dữ liệu này chưa có phiên profiling hoàn tất.</small>}
  </div>;
}

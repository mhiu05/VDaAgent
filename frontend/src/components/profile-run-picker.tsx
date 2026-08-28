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
  datasetId?: string;
  onDatasetChange?: (datasetId: string) => void;
  onValidityChange?: (valid: boolean) => void;
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

export function ProfileRunPicker({ id, label, value, onChange, datasetId: controlledDatasetId, onDatasetChange, onValidityChange, helpText, excludeRunId, disabled = false }: ProfileRunPickerProps) {
  const [internalDatasetId, setInternalDatasetId] = useState("");
  const datasetId = controlledDatasetId ?? internalDatasetId;
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
    const nextDatasetId = selectedProfile.data?.dataset_id;
    if (!nextDatasetId || nextDatasetId === datasetId) return;
    if (controlledDatasetId === undefined) setInternalDatasetId(nextDatasetId);
    onDatasetChange?.(nextDatasetId);
  }, [controlledDatasetId, datasetId, onDatasetChange, selectedProfile.data?.dataset_id]);

  useEffect(() => {
    const selectedRunIsAvailable = Boolean(value && datasetId && !runs.isPending && !runs.isError && runs.data?.some((run) => run.id === value && run.status === "completed" && run.id !== excludeRunId));
    onValidityChange?.(selectedRunIsAvailable);

    if (!value || runs.isPending || !runs.data) {
      if (value && runs.isError) onChange("");
      return;
    }
    if (runs.isError) {
      onChange("");
      return;
    }
    if (!selectedRunIsAvailable) onChange("");
  }, [datasetId, excludeRunId, onChange, onValidityChange, runs.data, runs.isError, runs.isPending, value]);

  function handleDatasetChange(nextDatasetId: string) {
    if (controlledDatasetId === undefined) setInternalDatasetId(nextDatasetId);
    onDatasetChange?.(nextDatasetId);
    onChange("");
  }

  return <div className="profile-run-picker">
    <span className="profile-run-picker-label">{label}</span>
    {helpText && <small className="hint">{helpText}</small>}
    <div className="profile-run-picker-controls">
      <div className="profile-run-picker-control">
        <label htmlFor={`${id}-dataset`}>1. Bộ dữ liệu</label>
        <select id={`${id}-dataset`} value={datasetId} onChange={(event) => handleDatasetChange(event.target.value)} disabled={disabled || datasets.isPending}>
          <option value="">Chọn bộ dữ liệu…</option>
          {datasets.data?.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>)}
        </select>
      </div>
      <div className="profile-run-picker-control">
        <label htmlFor={id}>2. Profile Run hoàn tất</label>
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || !datasetId || runs.isPending}>
          <option value="">Chọn phiên đã hoàn tất…</option>
          {runs.data?.filter((run) => run.status === "completed" && run.id !== excludeRunId).map((run) => <option value={run.id} key={run.id}>{profileRunOptionLabel(run)}</option>)}
        </select>
      </div>
    </div>
    {datasets.isError && <small className="hint">Không tải được danh sách bộ dữ liệu.</small>}
    {value && !datasetId && selectedProfile.isError && <small className="hint">Không xác định được bộ dữ liệu của Profile Run này. Hãy chọn lại từ danh sách.</small>}
    {datasetId && runs.isError && <small className="hint">Không tải được các phiên Profile Run của bộ dữ liệu này.</small>}
    {datasetId && !runs.isPending && !runs.isError && !runs.data?.some((run) => run.status === "completed" && run.id !== excludeRunId) && <small className="hint">Bộ dữ liệu này chưa có phiên profiling hoàn tất.</small>}
  </div>;
}

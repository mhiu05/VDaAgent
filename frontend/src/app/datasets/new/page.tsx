"use client";

import { type ChangeEvent, type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { connectGoogleDrive, createProfile, getGoogleDriveStatus, importGoogleDriveFile, listConnectors, listGoogleDriveFiles, startDatasetProfile, startDatasetProfiles, uploadDataset, useSavedDatasource, ApiError, type GoogleDriveStatus } from "@/lib/api";
import { humanFileSize } from "@/lib/format";
import type { UploadResult } from "@/lib/types";
import { ErrorNotice, LoadingButton, Notice, PageHeader, ProgressSteps } from "@/components/ui";
import { DatasourceConnector } from "@/components/datasource-connector";
import { useAuth } from "@/components/auth-provider";

const supportedExtensions = ["csv", "tsv", "parquet", "json"];
// Uploading one file at a time makes folder uploads unnecessarily slow, while
// starting every request at once can exhaust browser, API, and Drive capacity.
const maxConcurrentUploads = 3;

export default function NewDatasetPage() {
  const router = useRouter();
  const { authenticated, loading: authLoading, workspaceId } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [uploadResults, setUploadResults] = useState<Array<UploadResult | null>>([]);
  const [profiled, setProfiled] = useState<boolean[]>([]);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [scanMode, setScanMode] = useState<"full" | "sample">("sample");
  const [datasetName, setDatasetName] = useState("");
  const [busy, setBusy] = useState<"upload" | "import" | "profile" | null>(null);
  const [sourceMode, setSourceMode] = useState<"file" | "drive" | "datasource">("file");
  const [savedDatasourceId, setSavedDatasourceId] = useState("");
  const [showNewDatasource, setShowNewDatasource] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null);
  const [driveStatus, setDriveStatus] = useState<GoogleDriveStatus | null>(null);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [selectedDriveFileId, setSelectedDriveFileId] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const driveStatusSequence = useRef(0);
  const profileSubmissionKeys = useRef(new Map<string, string>());
  const profileInFlight = useRef(false);
  const connectorsQuery = useQuery({
    queryKey: ["connectors", workspaceId],
    queryFn: () => listConnectors(),
    enabled: authenticated && Boolean(workspaceId),
    staleTime: 30_000,
  });
  const driveFilesQuery = useQuery({
    queryKey: ["google-drive-files", workspaceId],
    queryFn: listGoogleDriveFiles,
    enabled: sourceMode === "drive" && Boolean(driveStatus?.connected),
    staleTime: 30_000,
  });
  const savedDatasourceOptions = (connectorsQuery.data?.connectors ?? []).filter((item) => item.category === "data" && item.provider === "mongodb" && item.id.startsWith("datasource:"));

  useEffect(() => {
    if (savedDatasourceId || !savedDatasourceOptions.length) return;
    const preferred = savedDatasourceOptions.find((item) => item.status === "connected") ?? savedDatasourceOptions[0];
    setSavedDatasourceId(preferred.id.slice("datasource:".length));
    setSourceMode("datasource");
  }, [savedDatasourceId, savedDatasourceOptions]);

  useEffect(() => {
    // React's DOM typings do not expose the non-standard directory picker
    // attribute, but Chromium/WebKit support it when set on the input.
    folderInputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const refreshDriveStatus = useCallback(async () => {
    // The API client gets its bearer token and workspace id from AuthProvider.
    // Do not query Drive during the initial render, otherwise the request can
    // race auth bootstrap and make an existing connection look absent.
    if (authLoading || !authenticated || !workspaceId) return;
    const sequence = ++driveStatusSequence.current;
    try {
      const status = await getGoogleDriveStatus();
      if (sequence === driveStatusSequence.current) setDriveStatus(status);
    } catch {
      if (sequence === driveStatusSequence.current) setDriveStatus(null);
    }
  }, [authLoading, authenticated, workspaceId]);

  useEffect(() => {
    void refreshDriveStatus();
    const handleDriveMessage = (event: MessageEvent<{ type?: string; status?: string; reason?: string }>) => {
      // The OAuth callback is served by the API (normally port 8000), not by
      // the Next.js application. Its postMessage event therefore has the API
      // origin rather than window.location.origin (normally port 3000).
      const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? `${window.location.protocol}//${window.location.hostname}:8000/api/v1`).origin;
      if (event.origin !== apiOrigin || event.data?.type !== "p170-google-drive") return;
      if (event.data.status === "connected") {
        setError(null);
        setDriveConnecting(false);
        void refreshDriveStatus();
      } else {
        setError(new ApiError(event.data.reason || "Kết nối Google Drive thất bại.", 400));
        setDriveConnecting(false);
      }
    };
    const handleWindowFocus = () => {
      void refreshDriveStatus();
      setDriveConnecting(false);
    };
    window.addEventListener("message", handleDriveMessage);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.removeEventListener("message", handleDriveMessage);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [refreshDriveStatus]);

  useEffect(() => {
    if (driveStatus?.connected) setDriveConnecting(false);
  }, [driveStatus]);

  function submissionKey(signature: string) {
    const scopedSignature = `${workspaceId ?? "pending"}:${signature}`;
    const cached = profileSubmissionKeys.current.get(scopedSignature);
    if (cached) return cached;
    const storageKey = `p170-profile-submission:${encodeURIComponent(scopedSignature)}`;
    try {
      const restored = window.sessionStorage.getItem(storageKey);
      if (restored) {
        profileSubmissionKeys.current.set(scopedSignature, restored);
        return restored;
      }
      const next = crypto.randomUUID();
      window.sessionStorage.setItem(storageKey, next);
      profileSubmissionKeys.current.set(scopedSignature, next);
      return next;
    } catch {
      const next = crypto.randomUUID();
      profileSubmissionKeys.current.set(scopedSignature, next);
      return next;
    }
  }

  function selectFiles(next: File[]) {
    setError(null);
    setSelectionWarning(null);
    setUploadResults([]);
    setProfiled([]);
    setProgress(0);
    setFiles([]);
    if (!next.length) return;

    const supported = next.filter((item) => {
      const extension = item.name.split(".").pop()?.toLowerCase();
      return extension && supportedExtensions.includes(extension);
    });
    const skipped = next.length - supported.length;
    if (!supported.length) {
      setError(new ApiError("Chỉ hỗ trợ file CSV, TSV, Parquet hoặc JSON.", 422));
      return;
    }
    if (skipped) {
      setSelectionWarning(`Đã bỏ qua ${skipped} file không được hỗ trợ. Chỉ nhận CSV, TSV, Parquet hoặc JSON.`);
    }
    setFiles(supported);
    setUploadResults(supported.map(() => null));
    setProfiled(supported.map(() => false));
    setDatasetName("");
  }

  async function handleUpload() {
    if (!files.length) return;
    setBusy("upload"); setError(null);
    abortRef.current = new AbortController();
    const results = files.map((_, index) => uploadResults[index] ?? null);
    const perFileProgress: number[] = results.map((upload) => upload ? 100 : 0);
    const pendingIndexes = results.flatMap((upload, index) => upload ? [] : [index]);
    let nextPendingIndex = 0;
    let reportedProgress = -1;
    let uploadFailure: unknown = null;

    const reportOverallProgress = () => {
      const nextProgress = Math.round(perFileProgress.reduce((total, value) => total + value, 0) / files.length);
      if (nextProgress === reportedProgress) return;
      reportedProgress = nextProgress;
      setProgress(nextProgress);
    };

    const isAbortError = (reason: unknown) => reason instanceof DOMException && reason.name === "AbortError";

    const uploadNextFile = async () => {
      while (true) {
        const index = pendingIndexes[nextPendingIndex];
        nextPendingIndex += 1;
        if (index === undefined) return;
        try {
          const uploaded = await uploadDataset(
            files[index],
            (fileProgress) => {
              perFileProgress[index] = fileProgress;
              reportOverallProgress();
            },
            abortRef.current?.signal,
          );
          results[index] = uploaded;
          perFileProgress[index] = 100;
          setUploadResults([...results]);
          reportOverallProgress();
        } catch (reason) {
          if (!isAbortError(reason) && !uploadFailure) uploadFailure = reason;
          abortRef.current?.abort();
          throw reason;
        }
      }
    };

    try {
      reportOverallProgress();
      await Promise.all(Array.from(
        { length: Math.min(maxConcurrentUploads, pendingIndexes.length) },
        () => uploadNextFile(),
      ));
    } catch (reason) {
      const failure = uploadFailure ?? reason;
      if (!isAbortError(failure)) setError(failure);
    } finally { setBusy(null); abortRef.current = null; }
  }

  async function handleProfile() {
    if (!files.length || !uploadResults.length || uploadResults.some((item) => !item)) return;
    if (profileInFlight.current) return;
    profileInFlight.current = true;
    setBusy("profile"); setError(null);
    const completed = [...profiled];
    try {
      if (!datasetName.trim()) {
        setError(new ApiError("Hãy nhập tên bộ dữ liệu trước khi profiling.", 422));
        return;
      }
      const uploads = uploadResults.map((upload, index) => ({ upload, index })).filter((item): item is { upload: UploadResult; index: number } => Boolean(item.upload));
      if (files.length === 1) {
        const { upload, index } = uploads[0];
        const payload = { dataset_name: upload.suggested_name || upload.filename, collection_name: datasetName.trim(), scan_mode: scanMode, ...(scanMode === "sample" ? { sampling: { strategy: "reservoir" as const } } : {}) };
        const signature = JSON.stringify({ dataset_id: upload.dataset_id, ...payload });
        const key = submissionKey(signature);
        const result = upload.dataset_id ? await startDatasetProfile(upload.dataset_id, payload, key) : await createProfile({ ...payload, dataset_ref: upload.dataset_ref }, key);
        completed[index] = true;
        setProfiled([...completed]);
        const runId = "run_id" in result ? result.run_id : result.profiling_run_id;
        router.push(`/profiles/${runId}`);
        return;
      }
      const datasetIds = uploads.flatMap(({ upload }) => upload.dataset_id ? [upload.dataset_id] : []);
      if (datasetIds.length !== files.length) throw new ApiError("Không tìm thấy mã dataset vừa tải lên.", 400);
      const batchPayload = { dataset_ids: datasetIds, dataset_name: datasetName.trim(), collection_name: datasetName.trim(), scan_mode: scanMode, ...(scanMode === "sample" ? { sampling: { strategy: "reservoir" as const } } : {}) };
      const results = await startDatasetProfiles(batchPayload, submissionKey(JSON.stringify(batchPayload)));
      results.forEach((result, index) => { if (result.run_id && result.status !== "failed") completed[index] = true; });
      setProfiled([...completed]);
      const failed = results.filter((result) => result.status === "failed");
      if (failed.length) {
        setError(new ApiError(`${failed.length} dataset không thể xếp hàng profiling. Bạn có thể thử lại; các dataset đã thành công sẽ không bị tạo trùng.`, 409));
        return;
      }
      // A batch has several runs, so enter the first durable Command Center
      // immediately; the Dataset list remains the place to open its peers.
      router.push(`/profiles/${results[0].run_id}`);
    } catch (reason) { setError(reason); } finally { profileInFlight.current = false; setBusy(null); }
  }

  async function handleConnectDrive() {
    setDriveConnecting(true);
    setError(null);
    // Open the tab synchronously from the click handler so popup blockers do
    // not reject it while the authorization URL is being fetched.
    const oauthWindow = window.open("about:blank", "_blank");
    if (!oauthWindow) {
      setError(new ApiError("Trình duyệt đã chặn tab Google mới. Hãy cho phép popup rồi thử lại.", 0));
      setDriveConnecting(false);
      return;
    }
    // Keep the popup visibly occupied while the authorization URL is fetched.
    // The callback uses this opener to notify the original upload tab and
    // close itself after Google finishes.
    try {
      oauthWindow.document.title = "Connecting Google Drive...";
      oauthWindow.document.body.textContent = "Connecting Google Drive...";
    } catch {
      // The blank window can become cross-origin immediately in some browsers.
    }
    try {
      await connectGoogleDrive(oauthWindow);
    } catch (reason) {
      oauthWindow.close();
      setError(reason);
      setDriveConnecting(false);
    }
  }

  async function handleUseSavedDatasource() {
    if (!savedDatasourceId || !datasetName.trim()) {
      setError(new ApiError("Chọn datasource và nhập tên dataset trước khi tiếp tục.", 422));
      return;
    }
    if (profileInFlight.current) return;
    profileInFlight.current = true;
    setBusy("profile");
    setError(null);
    try {
      const result = await useSavedDatasource(savedDatasourceId, datasetName.trim());
      const payload = { dataset_name: result.name, scan_mode: scanMode };
      const job = await startDatasetProfile(result.dataset_id, payload, submissionKey(JSON.stringify({ dataset_id: result.dataset_id, ...payload })));
      router.push(`/profiles/${job.run_id}`);
    } catch (reason) {
      setError(reason);
    } finally {
      profileInFlight.current = false;
      setBusy(null);
    }
  }

  async function handleDriveImport() {
    if (!selectedDriveFileId) return;
    if (profileInFlight.current) return;
    profileInFlight.current = true;
    setBusy("import");
    setError(null);
    try {
      const imported = await importGoogleDriveFile(
        selectedDriveFileId,
        datasetName.trim() || undefined,
        submissionKey(`drive:${selectedDriveFileId}`),
      );
      if (!imported.dataset_id) throw new ApiError("Drive import did not create a dataset.", 500);
      setBusy("profile");
      const payload = { dataset_name: imported.suggested_name || imported.filename, scan_mode: scanMode };
      const job = await startDatasetProfile(
        imported.dataset_id,
        payload,
        submissionKey(JSON.stringify({ dataset_id: imported.dataset_id, ...payload })),
      );
      router.push(`/profiles/${job.run_id}`);
    } catch (reason) {
      setError(reason);
    } finally {
      profileInFlight.current = false;
      setBusy(null);
    }
  }

  function handleUploadClick() {
    if (driveBlocked) {
      if (driveStatus?.can_connect) void handleConnectDrive();
      return;
    }
    void handleUpload();
  }

  const fileInput = (event: ChangeEvent<HTMLInputElement>) => {
    selectFiles(Array.from(event.target.files ?? []));
    event.currentTarget.value = "";
  };
  const fileDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    selectFiles(Array.from(event.dataTransfer.files));
  };
  const driveBlocked = false;
  const allUploaded = files.length > 0 && uploadResults.length === files.length && uploadResults.every(Boolean);
  const uploadedCount = uploadResults.filter(Boolean).length;
  const profiledCount = profiled.filter(Boolean).length;
  const selectedPath = (file: File) => file.webkitRelativePath || file.name;
  return <>
    <PageHeader eyebrow="Bộ dữ liệu mới" title="Tải lên và bắt đầu profiling" description="Hệ thống sẽ tự động quét và phân tích dữ liệu của bạn một cách bảo mật. Các chỉ số được tính toán chính xác tuyệt đối, AI chỉ đóng vai trò hỗ trợ gợi ý thông tin." />
    {error && <ErrorNotice error={error} retry={files.length && !allUploaded ? handleUpload : allUploaded ? handleProfile : undefined} />}
    {selectionWarning && <Notice tone="info"><p>{selectionWarning}</p></Notice>}
    {sourceMode === "drive" && driveStatus && <Notice tone={driveStatus.connected ? "success" : "info"}>
      <b>{driveStatus.connected ? "Google Drive đã kết nối." : "Cần kết nối Google Drive trước khi upload."}</b>
      {!driveStatus.connected && <p>{driveStatus.can_connect ? "Bạn chỉ cần kết nối Google Drive 1 lần trong 1 workspace." : "Workspace hiện chưa cho phép kết nối Google Drive."}</p>}
      {!driveStatus.connected && driveStatus.can_connect && <LoadingButton className="button secondary" onClick={handleConnectDrive} busy={driveConnecting}>{driveConnecting ? "Đang mở Google…" : "Kết nối Google Drive"}</LoadingButton>}
    </Notice>}
    <div className="inline-actions" role="tablist" aria-label="Kiểu nguồn dữ liệu"><button type="button" className={`button ${sourceMode === "file" ? "primary" : "secondary"}`} onClick={() => setSourceMode("file")}>File từ máy</button><button type="button" className={`button ${sourceMode === "drive" ? "primary" : "secondary"}`} onClick={() => setSourceMode("drive")}>Google Drive</button><button type="button" className={`button ${sourceMode === "datasource" ? "primary" : "secondary"}`} onClick={() => setSourceMode("datasource")}>MongoDB Atlas</button></div>
    {sourceMode === "drive" ? <section className="panel"><div className="panel-title"><h2>Import from Google Drive</h2><small>The selected file is copied once into workspace storage before profiling.</small></div>{!driveStatus?.connected ? <Notice tone="info">Connect Google Drive to select a file. Existing imports remain usable after disconnect.</Notice> : driveFilesQuery.isPending ? <p className="muted">Loading Drive files…</p> : <div className="form-grid"><div className="field full"><label htmlFor="drive-file">Drive file</label><select id="drive-file" value={selectedDriveFileId} onChange={(event) => setSelectedDriveFileId(event.target.value)} disabled={busy !== null}><option value="">Select a file</option>{(driveFilesQuery.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.size_bytes ? ` · ${humanFileSize(item.size_bytes)}` : ""}</option>)}</select></div><div className="field full"><label htmlFor="drive-dataset-name">Dataset name</label><input id="drive-dataset-name" value={datasetName} onChange={(event) => setDatasetName(event.target.value)} maxLength={255} placeholder="Keep the Drive filename" disabled={busy !== null} /></div><div className="field"><label htmlFor="drive-scan-mode">Scan mode</label><select id="drive-scan-mode" value={scanMode} onChange={(event) => setScanMode(event.target.value as "full" | "sample")} disabled={busy !== null}><option value="sample">Sample</option><option value="full">Full scan</option></select></div></div>}<div className="form-actions">{!driveStatus?.connected && driveStatus?.can_connect ? <LoadingButton className="button secondary" onClick={handleConnectDrive} busy={driveConnecting}>Connect Google Drive</LoadingButton> : <LoadingButton className="button primary" onClick={handleDriveImport} busy={busy !== null} disabled={!selectedDriveFileId || busy !== null}>Import and profile</LoadingButton>}</div></section> : sourceMode === "datasource" ? <div className="stacked-section">
      <section className="panel saved-datasource-panel">
        <div className="panel-title"><h2>Dùng MongoDB Atlas đã kết nối</h2><small>Credential vẫn nằm ở backend; dataset mới chỉ tham chiếu connection dùng chung.</small></div>
        {!!savedDatasourceOptions.length && <div className="form-grid">
          <div className="field"><label htmlFor="saved-datasource">Datasource</label><select id="saved-datasource" value={savedDatasourceId} onChange={(event) => setSavedDatasourceId(event.target.value)} disabled={busy !== null}><option value="">Chọn connection</option>{savedDatasourceOptions.map((item) => <option key={item.id} value={item.id.slice("datasource:".length)}>{item.name}</option>)}</select></div>
          <div className="field"><label htmlFor="saved-dataset-name">Tên dataset</label><input id="saved-dataset-name" value={datasetName} onChange={(event) => setDatasetName(event.target.value)} placeholder="Ví dụ: Bán hàng tháng 8" maxLength={255} disabled={busy !== null} /></div>
        </div>}
        {!savedDatasourceOptions.length && <Notice tone="info">Chưa có MongoDB Atlas nào được lưu. Hãy tạo connection mới bên dưới.</Notice>}
        {!!savedDatasourceOptions.length && <div className="form-actions"><LoadingButton className="button primary" busy={busy === "profile"} disabled={!savedDatasourceId || !datasetName.trim() || busy !== null} onClick={handleUseSavedDatasource}>Dùng datasource và profiling</LoadingButton><button type="button" className="button secondary" onClick={() => setShowNewDatasource((value) => !value)}>{showNewDatasource ? "Ẩn connection mới" : "Thêm MongoDB Atlas khác"}</button></div>}
      </section>
      {(!savedDatasourceOptions.length || showNewDatasource) && <DatasourceConnector onBack={savedDatasourceOptions.length ? () => setShowNewDatasource(false) : undefined} />}
    </div> : <div className="grid two">
      <section className="panel"><div className="panel-title"><h2>1. Chọn dữ liệu</h2><small>Chọn một, nhiều file hoặc cả thư mục</small></div>
        <div className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={fileDrop}>
          <div><strong>Kéo thả một hoặc nhiều file vào đây</strong><p className="muted">CSV, TSV, Parquet hoặc JSON</p><div className="inline-actions file-picker-actions"><label className="button secondary">Chọn file<input type="file" multiple accept=".csv,.tsv,.parquet,.json,application/json,text/csv" onChange={fileInput} /></label><label className="button secondary">Chọn thư mục<input ref={folderInputRef} type="file" multiple accept=".csv,.tsv,.parquet,.json,application/json,text/csv" onChange={fileInput} /></label></div>
            {!!files.length && <div className="upload-selection-summary"><b>{files.length} file đã chọn</b><small>{uploadedCount}/{files.length} file đã tải lên{files.length > 1 ? ` · tối đa ${maxConcurrentUploads} file đồng thời` : ""}</small></div>}
            {!!files.length && <ul className="upload-file-list">{files.map((item, index) => <li className="upload-file-row" key={`${selectedPath(item)}-${item.size}-${item.lastModified}`}><span title={selectedPath(item)}>{selectedPath(item)}</span><small>{uploadResults[index] ? "Đã tải" : busy === "upload" ? "Đang tải…" : "Chờ tải"} · {humanFileSize(item.size)}</small></li>)}</ul>}
            {busy === "upload" && <><div className="upload-progress"><span style={{ width: `${progress}%` }} /></div><small>{progress}% đang tải lên</small></>}
          </div>
        </div>
        <div className="form-actions">{!allUploaded ? <><LoadingButton className="button primary" busy={busy === "upload"} disabled={!files.length || busy !== null || (driveBlocked && !driveStatus?.can_connect)} onClick={handleUploadClick}>{busy === "upload" ? "Đang tải lên…" : driveBlocked ? driveStatus?.can_connect ? "Kết nối Drive để tải" : "Drive chưa sẵn sàng" : uploadedCount ? `Tải tiếp ${files.length - uploadedCount} file` : "Tải dữ liệu lên"}</LoadingButton>{busy === "upload" && <button className="button secondary" onClick={() => abortRef.current?.abort()}>Hủy tải lên</button>}</> : <Notice tone="success"><b>Đã tải lên an toàn.</b><p>{files.length} file đã được lưu vào workspace.</p></Notice>}</div>
      </section>
      <section className="panel"><div className="panel-title"><h2>2. Cấu hình profiling</h2><small>Sampling có thể tái lập</small></div>
        <div className="form-grid"><div className="field full"><label htmlFor="dataset-name">Tên bộ dữ liệu</label><input id="dataset-name" value={datasetName} onChange={(event) => setDatasetName(event.target.value)} placeholder="Ví dụ: Dữ liệu bán hàng tháng 8" maxLength={255} disabled={!files.length || busy !== null} /><small className="muted">{files.length > 1 ? `Tên này gộp ${files.length} file thành một bộ; tên từng file vẫn được giữ nguyên.` : "Tên này dùng để phân loại dataset trong workspace."}</small></div><div className="field"><label htmlFor="scan-mode">Chế độ scan</label><select id="scan-mode" value={scanMode} onChange={(event) => setScanMode(event.target.value as "full" | "sample")} disabled={!allUploaded}><option value="sample">Sample — nhanh, có uncertainty</option><option value="full">Full scan — chính xác hơn</option></select></div></div>
        <Notice tone="info"><b>Bảo mật quyền riêng tư</b><p>Hệ thống sẽ không hiển thị các dữ liệu mẫu nhạy cảm. Mọi phát hiện về thông tin cá nhân hoặc định danh đều cần bạn xác nhận trước khi lưu.</p></Notice>
        {busy === "profile" && <ProgressSteps steps={["Chuẩn bị", "Đang profiling", "Hoàn tất"]} activeStep={profiledCount === files.length ? 2 : 1} detail={`Đã xử lý ${profiledCount}/${files.length} file. Hệ thống đang tính metric từ dữ liệu thật.`} />}
        <div className="form-actions"><LoadingButton className="button primary" busy={busy === "profile"} disabled={!allUploaded || busy !== null} onClick={handleProfile}>{busy === "profile" ? `Agent đang profiling… (${profiledCount}/${files.length})` : files.length > 1 ? `Bắt đầu profiling ${files.length} file` : "Bắt đầu profiling"}</LoadingButton></div>
      </section>
    </div>}
  </>;
}

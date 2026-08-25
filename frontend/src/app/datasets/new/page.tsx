"use client";

import { type ChangeEvent, type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { connectGoogleDrive, createProfile, getGoogleDriveStatus, setDatasetCollection, uploadDataset, ApiError, type GoogleDriveStatus } from "@/lib/api";
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
  const [savingCollection, setSavingCollection] = useState(false);
  const [collectionSaved, setCollectionSaved] = useState(false);
  const [busy, setBusy] = useState<"upload" | "profile" | null>(null);
  const [sourceMode, setSourceMode] = useState<"file" | "datasource">("file");
  const [error, setError] = useState<unknown>(null);
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null);
  const [driveStatus, setDriveStatus] = useState<GoogleDriveStatus | null>(null);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const driveStatusSequence = useRef(0);
  const profileSubmissionKeys = useRef(new Map<string, string>());

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

  function selectFiles(next: File[]) {
    setError(null);
    setSelectionWarning(null);
    setUploadResults([]);
    setProfiled([]);
    setProgress(0);
    setCollectionSaved(false);
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

  async function saveDatasetCollection(): Promise<boolean> {
    if (!allUploaded) {
      setError(new ApiError("Hãy tải dữ liệu lên trước khi lưu tên bộ.", 422));
      return false;
    }
    if (!datasetName.trim()) {
      setError(new ApiError("Hãy nhập tên bộ dữ liệu trước khi lưu.", 422));
      return false;
    }
    const datasetIds = uploadResults.flatMap((upload) => upload?.dataset_id ? [upload.dataset_id] : []);
    if (datasetIds.length !== files.length) {
      setError(new ApiError("Không tìm thấy mã dataset vừa tải lên.", 400));
      return false;
    }
    setSavingCollection(true);
    setError(null);
    try {
      await setDatasetCollection(datasetIds, datasetName.trim());
      setCollectionSaved(true);
      return true;
    } catch (reason) {
      setError(reason);
      return false;
    } finally {
      setSavingCollection(false);
    }
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
    setBusy("profile"); setError(null);
    const completed = [...profiled];
    try {
      if (datasetName.trim() && !collectionSaved && !(await saveDatasetCollection())) return;
      for (let index = 0; index < files.length; index += 1) {
        if (completed[index]) continue;
        const upload = uploadResults[index];
        if (!upload) continue;
        const payload = {
          ...(upload.dataset_id ? { dataset_id: upload.dataset_id } : { dataset_ref: upload.dataset_ref }),
          dataset_name: upload.suggested_name || upload.filename,
          scan_mode: scanMode,
          ...(scanMode === "sample" ? { sampling: { strategy: "reservoir" as const } } : {}),
        } as const;
        const signature = JSON.stringify(payload);
        const idempotencyKey = profileSubmissionKeys.current.get(signature) || crypto.randomUUID();
        profileSubmissionKeys.current.set(signature, idempotencyKey);
        const job = await createProfile(payload, idempotencyKey);
        profileSubmissionKeys.current.delete(signature);
        completed[index] = true;
        setProfiled([...completed]);
        if (files.length === 1) {
          router.push(`/profiles/${job.profiling_run_id}`);
          return;
        }
      }
      router.push("/datasets");
    } catch (reason) { setError(reason); } finally { setBusy(null); }
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
  const driveBlocked = driveStatus?.provider === "google_drive" && !driveStatus.connected;
  const allUploaded = files.length > 0 && uploadResults.length === files.length && uploadResults.every(Boolean);
  const uploadedCount = uploadResults.filter(Boolean).length;
  const profiledCount = profiled.filter(Boolean).length;
  const selectedPath = (file: File) => file.webkitRelativePath || file.name;
  return <>
    <PageHeader eyebrow="Bộ dữ liệu mới" title="Tải lên và bắt đầu profiling" description="Hệ thống sẽ tự động quét và phân tích dữ liệu của bạn một cách bảo mật. Các chỉ số được tính toán chính xác tuyệt đối, AI chỉ đóng vai trò hỗ trợ gợi ý thông tin." />
    {error && <ErrorNotice error={error} retry={files.length && !allUploaded ? handleUpload : allUploaded ? handleProfile : undefined} />}
    {selectionWarning && <Notice tone="info"><p>{selectionWarning}</p></Notice>}
    {driveStatus?.provider === "google_drive" && <Notice tone={driveStatus.connected ? "success" : "info"}>
      <b>{driveStatus.connected ? "Google Drive đã kết nối." : "Cần kết nối Google Drive trước khi upload."}</b>
      {!driveStatus.connected && <p>{driveStatus.can_connect ? "Bạn chỉ cần kết nối Google Drive 1 lần trong 1 workspace." : "Workspace hiện chưa cho phép kết nối Google Drive."}</p>}
      {!driveStatus.connected && driveStatus.can_connect && <LoadingButton className="button secondary" onClick={handleConnectDrive} busy={driveConnecting}>{driveConnecting ? "Đang mở Google…" : "Kết nối Google Drive"}</LoadingButton>}
    </Notice>}
    <div className="inline-actions" role="tablist" aria-label="Kiểu nguồn dữ liệu"><button type="button" className={`button ${sourceMode === "file" ? "primary" : "secondary"}`} onClick={() => setSourceMode("file")}>File từ máy</button><button type="button" className={`button ${sourceMode === "datasource" ? "primary" : "secondary"}`} onClick={() => setSourceMode("datasource")}>MySQL / MongoDB / DuckDB</button></div>
    {sourceMode === "datasource" ? <DatasourceConnector /> : <div className="grid two">
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
        <div className="form-grid"><div className="field full"><label htmlFor="dataset-name">Tên bộ dữ liệu</label><input id="dataset-name" value={datasetName} onChange={(event) => { setDatasetName(event.target.value); setCollectionSaved(false); }} placeholder="Ví dụ: Dữ liệu bán hàng tháng 8" maxLength={255} disabled={!files.length || busy !== null || savingCollection} /><small className="muted">{files.length > 1 ? `Tên này gộp ${files.length} file thành một bộ; tên từng file vẫn được giữ nguyên.` : "Tên này dùng để phân loại dataset trong workspace."}{collectionSaved ? " Đã lưu." : ""}</small></div><div className="field"><label htmlFor="scan-mode">Chế độ scan</label><select id="scan-mode" value={scanMode} onChange={(event) => setScanMode(event.target.value as "full" | "sample")} disabled={!allUploaded}><option value="sample">Sample — nhanh, có uncertainty</option><option value="full">Full scan — chính xác hơn</option></select></div></div>
        <Notice tone="info"><b>Bảo mật quyền riêng tư</b><p>Hệ thống sẽ không hiển thị các dữ liệu mẫu nhạy cảm. Mọi phát hiện về thông tin cá nhân hoặc định danh đều cần bạn xác nhận trước khi lưu.</p></Notice>
        {busy === "profile" && <ProgressSteps steps={["Chuẩn bị", "Đang profiling", "Hoàn tất"]} activeStep={profiledCount === files.length ? 2 : 1} detail={`Đã xử lý ${profiledCount}/${files.length} file. Hệ thống đang tính metric từ dữ liệu thật.`} />}
        <div className="form-actions"><LoadingButton className="button primary" busy={busy === "profile"} disabled={!allUploaded || busy !== null || savingCollection} onClick={handleProfile}>{busy === "profile" ? `Agent đang profiling… (${profiledCount}/${files.length})` : files.length > 1 ? `Bắt đầu profiling ${files.length} file` : "Bắt đầu profiling"}</LoadingButton></div>
      </section>
    </div>}
  </>;
}

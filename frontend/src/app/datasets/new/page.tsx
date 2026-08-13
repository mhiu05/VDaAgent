"use client";

import { type ChangeEvent, type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { connectGoogleDrive, createProfile, getGoogleDriveStatus, uploadDataset, ApiError, type GoogleDriveStatus } from "@/lib/api";
import { humanFileSize } from "@/lib/format";
import type { UploadResult } from "@/lib/types";
import { ErrorNotice, Notice, PageHeader } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";

const supportedExtensions = ["csv", "tsv", "parquet", "json"];

export default function NewDatasetPage() {
  const router = useRouter();
  const { authenticated, loading: authLoading, workspaceId } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [scanMode, setScanMode] = useState<"full" | "sample">("sample");
  const [datasetName, setDatasetName] = useState("");
  const [busy, setBusy] = useState<"upload" | "profile" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [driveStatus, setDriveStatus] = useState<GoogleDriveStatus | null>(null);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const driveStatusSequence = useRef(0);

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
      if (event.origin !== window.location.origin || event.data?.type !== "p170-google-drive") return;
      if (event.data.status === "connected") {
        setError(null);
        void refreshDriveStatus();
      } else {
        setError(new ApiError(event.data.reason || "Kết nối Google Drive thất bại.", 400));
        setDriveConnecting(false);
      }
    };
    window.addEventListener("message", handleDriveMessage);
    return () => {
      window.removeEventListener("message", handleDriveMessage);
    };
  }, [refreshDriveStatus]);

  function selectFile(next: File | null) {
    setError(null);
    setUpload(null);
    setProgress(0);
    if (!next) return setFile(null);
    const extension = next.name.split(".").pop()?.toLowerCase();
    if (!extension || !supportedExtensions.includes(extension)) {
      setFile(null);
      setError(new ApiError("Chỉ hỗ trợ file CSV, TSV, Parquet hoặc JSON.", 422));
      return;
    }
    setFile(next);
    setDatasetName(next.name.replace(/\.[^.]+$/, ""));
  }

  async function handleUpload() {
    if (!file) return;
    setBusy("upload"); setError(null);
    abortRef.current = new AbortController();
    try {
      setUpload(await uploadDataset(file, setProgress, abortRef.current.signal));
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason);
    } finally { setBusy(null); abortRef.current = null; }
  }

  async function handleProfile() {
    if (!upload) return;
    setBusy("profile"); setError(null);
    try {
      const profile = await createProfile({
        ...(upload.dataset_id ? { dataset_id: upload.dataset_id } : { dataset_ref: upload.dataset_ref }),
        dataset_name: datasetName.trim() || upload.suggested_name || upload.filename,
        scan_mode: scanMode,
        ...(scanMode === "sample" ? { sampling: { strategy: "reservoir" } } : {}),
      });
      router.push(`/profiles/${profile.profile_run_id}`);
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

  const fileInput = (event: ChangeEvent<HTMLInputElement>) => selectFile(event.target.files?.[0] ?? null);
  const fileDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files?.[0] ?? null); };
  const driveBlocked = driveStatus?.provider === "google_drive" && !driveStatus.connected;
  return <>
    <PageHeader eyebrow="Bộ dữ liệu mới" title="Tải lên và bắt đầu profiling" description="File được gửi trực tiếp tới API. Compute engine tạo metric; Agent chỉ đề xuất metadata kèm evidence." />
    {error && <ErrorNotice error={error} retry={file && !upload ? handleUpload : undefined} />}
    {driveStatus?.provider === "google_drive" && <Notice tone={driveStatus.connected ? "success" : "info"}>
      <b>{driveStatus.connected ? "Google Drive đã kết nối." : "Cần kết nối Google Drive trước khi upload."}</b>
      {!driveStatus.connected && <p>{driveStatus.can_connect ? "Bạn có thể tự kết nối Google Drive một lần bằng tài khoản Google của mình." : "Liên hệ Admin workspace để kết nối Google Drive."}</p>}
      {!driveStatus.connected && driveStatus.can_connect && <button className="button secondary" onClick={handleConnectDrive} disabled={driveConnecting}>{driveConnecting ? "Đang mở Google…" : "Kết nối Google Drive"}</button>}
    </Notice>}
    <div className="grid two">
      <section className="panel"><div className="panel-title"><h2>1. Chọn file</h2><small>Kích thước tối đa theo policy của API</small></div>
        <div className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={fileDrop}>
          <div><strong>Kéo thả file vào đây</strong><p className="muted">CSV, TSV, Parquet hoặc JSON</p><label className="button secondary">Chọn file<input type="file" accept=".csv,.tsv,.parquet,.json,application/json,text/csv" onChange={fileInput} /></label>
            {file && <p><b>{file.name}</b> · {humanFileSize(file.size)}</p>}
            {busy === "upload" && <><div className="upload-progress"><span style={{ width: `${progress}%` }} /></div><small>{progress}% đang tải lên</small></>}
          </div>
        </div>
        <div className="form-actions">{!upload ? <><button className="button primary" disabled={!file || busy !== null || driveBlocked} onClick={handleUpload}>{busy === "upload" ? "Đang tải lên…" : "Tải file lên"}</button>{busy === "upload" && <button className="button secondary" onClick={() => abortRef.current?.abort()}>Hủy tải lên</button>}</> : <Notice tone="success"><b>Đã tải lên an toàn.</b><p>{upload.filename} · {humanFileSize(upload.size_bytes)}</p></Notice>}</div>
      </section>
      <section className="panel"><div className="panel-title"><h2>2. Cấu hình profiling</h2><small>Sampling có thể tái lập</small></div>
        <div className="form-grid"><div className="field full"><label htmlFor="dataset-name">Tên bộ dữ liệu</label><input id="dataset-name" value={datasetName} onChange={(event) => setDatasetName(event.target.value)} maxLength={255} disabled={!upload} /></div><div className="field"><label htmlFor="scan-mode">Chế độ scan</label><select id="scan-mode" value={scanMode} onChange={(event) => setScanMode(event.target.value as "full" | "sample")} disabled={!upload}><option value="sample">Sample — nhanh, có uncertainty</option><option value="full">Full scan — chính xác hơn</option></select></div></div>
        <Notice tone="info"><b>Ranh giới privacy</b><p>PII candidate và candidate key luôn chờ analyst review; mẫu dữ liệu nhạy cảm không được render.</p></Notice>
        <div className="form-actions"><button className="button primary" disabled={!upload || busy !== null} onClick={handleProfile}>{busy === "profile" ? "Agent đang profiling…" : "Bắt đầu profiling"}</button></div>
      </section>
    </div>
  </>;
}

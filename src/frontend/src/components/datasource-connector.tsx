"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { connectDatasource, createProfile, saveDatasourceConnection, testDatasource } from "@/lib/api";
import type { DatasourceConfig, DatasourceKind } from "@/lib/types";
import { ErrorNotice, LoadingButton, Notice, ProgressSteps } from "@/components/ui";

type DatasourceConnectorProps = {
  initialKind?: DatasourceKind;
  onBack?: () => void;
  saveOnly?: boolean;
  onSaved?: () => void;
};

export function DatasourceConnector({
  initialKind = "mongodb",
  onBack,
  saveOnly = false,
  onSaved,
}: DatasourceConnectorProps) {
  const router = useRouter();
  const [kind] = useState<DatasourceKind>(initialKind);
  const [name, setName] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("3306");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [uri, setUri] = useState("");
  const [collection, setCollection] = useState("");
  const [filter, setFilter] = useState("{}");
  const [path, setPath] = useState("");
  const [table, setTable] = useState("");
  const [query, setQuery] = useState("");
  const [objects, setObjects] = useState<string[]>([]);
  const [busy, setBusy] = useState<"test" | "connect" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tested, setTested] = useState(false);
  const [message, setMessage] = useState("");
  const [showUri, setShowUri] = useState(false);

  function config(): DatasourceConfig {
    if (kind === "mysql") {
      return {
        host,
        port: Number(port),
        user,
        password,
        database,
        ...(table ? { table } : {}),
        ...(query ? { query } : {}),
      };
    }
    if (kind === "mongodb") {
      return {
        uri: uri.trim(),
        database: database.trim(),
        ...(collection.trim() ? { collection: collection.trim() } : {}),
        filter: filter.trim() || "{}",
      };
    }
    return { path, ...(table ? { table } : {}), ...(query ? { query } : {}) };
  }

  function validateConfig(requireCollection: boolean): Error | null {
    if (kind !== "mongodb") return null;

    const normalizedUri = uri.trim();
    if (!normalizedUri) return new Error("Hãy dán MongoDB URI lấy từ Atlas → Connect → Drivers.");
    if (!/^mongodb(?:\+srv)?:\/\//.test(normalizedUri)) {
      return new Error("MongoDB URI phải bắt đầu bằng mongodb:// hoặc mongodb+srv://.");
    }
    if (!database.trim()) return new Error("Hãy nhập đúng tên database cần đọc.");
    if (requireCollection && !collection.trim()) {
      return new Error("Hãy chọn collection sau khi kiểm tra kết nối.");
    }
    try {
      const parsed = JSON.parse(filter.trim() || "{}");
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("not-object");
    } catch {
      return new Error('Filter JSON phải là một object, ví dụ: {"status":"active"}.');
    }
    return null;
  }

  function resetMongoTest() {
    setTested(false);
    setMessage("");
    setObjects([]);
    setCollection("");
  }

  async function handleTest() {
    const validationError = validateConfig(false);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy("test");
    setError(null);
    setMessage("");
    setObjects([]);
    setTested(false);
    try {
      const result = await testDatasource(kind, name || "Datasource", config());
      setObjects(result.objects);
      if (kind !== "mongodb" && !table && result.objects[0]) setTable(result.objects[0]);
      setTested(true);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(null);
    }
  }

  async function handleConnect() {
    const validationError = validateConfig(true);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!name.trim()) {
      setError(new Error(saveOnly ? "Hãy nhập tên connector." : "Hãy nhập tên dataset."));
      return;
    }

    setBusy("connect");
    setError(null);
    setMessage("");
    try {
      if (saveOnly) {
        await saveDatasourceConnection(kind, name.trim(), config(), crypto.randomUUID());
        onSaved?.();
        setMessage("Đã lưu connector sẵn sàng dùng cho nhiều dataset.");
        setTested(true);
        return;
      }
      const connected = await connectDatasource(kind, name.trim(), config());
      const job = await createProfile({
        dataset_id: connected.dataset_id,
        dataset_name: connected.name,
        scan_mode: "sample",
      }, crypto.randomUUID());
      router.push(`/profiles/${job.profiling_run_id}/review`);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(null);
    }
  }

  const objectLabel = kind === "mongodb" ? "Collection" : "Bảng";
  const availableObjectLabel = kind === "mongodb" ? "collection" : "bảng";
  const requiredMark = <span className="field-required" aria-hidden="true">*</span>;
  const mongoReadyToSave = kind !== "mongodb" || (tested && Boolean(collection.trim()));

  return <section className="panel datasource-connector-panel">
    {onBack && <div className="form-actions">
      <button type="button" className="button secondary" onClick={onBack}>Quay lại danh sách connectors</button>
    </div>}

    <div className="panel-title">
      <h2>{saveOnly ? "Lưu connector datasource" : "Kết nối datasource"}</h2>
      <small>Nguồn được đọc theo từng lần profiling, credential được mã hóa phía backend.</small>
    </div>

    {error ? <ErrorNotice error={error} retry={busy === null ? handleTest : undefined} /> : null}
    {message && <Notice tone="success"><b>{message}</b></Notice>}

    <div className="form-grid">
      <div className="field full">
        <label htmlFor="datasource-name">{saveOnly ? "Tên connector" : "Tên dataset"} {requiredMark}</label>
        <input
          id="datasource-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ví dụ: MongoDB Atlas - sample_mflix"
          maxLength={255}
          autoComplete="off"
        />
      </div>

      {kind === "mysql" && <>
        <div className="field"><label htmlFor="mysql-host">Host</label><input id="mysql-host" value={host} onChange={(event) => setHost(event.target.value)} /></div>
        <div className="field"><label htmlFor="mysql-port">Port</label><input id="mysql-port" type="number" value={port} onChange={(event) => setPort(event.target.value)} /></div>
        <div className="field"><label htmlFor="mysql-user">User</label><input id="mysql-user" value={user} onChange={(event) => setUser(event.target.value)} /></div>
        <div className="field"><label htmlFor="mysql-password">Password</label><input id="mysql-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
        <div className="field"><label htmlFor="mysql-database">Database</label><input id="mysql-database" value={database} onChange={(event) => setDatabase(event.target.value)} /></div>
      </>}

      {kind === "mongodb" && <>
        <div className="datasource-help full" role="note">
          <div className="datasource-help-heading">
            <div><p className="eyebrow">MONGODB ATLAS</p><h3>Kiểm tra URI và database trước</h3></div>
            <a href="https://cloud.mongodb.com/" target="_blank" rel="noreferrer">Mở Atlas ↗</a>
          </div>
          <p>Dùng URI trong Atlas: <b>Connect → Drivers</b>. Sau khi kiểm tra thành công, bạn sẽ chọn collection từ danh sách trả về.</p>
          <div className="datasource-help-grid">
            <div><span>1</span><p><b>Database user</b><small>Có quyền đọc database cần phân tích.</small></p></div>
            <div><span>2</span><p><b>Network Access</b><small>Allowlist IP của máy chạy backend.</small></p></div>
            <div><span>3</span><p><b>Database</b><small>Collection được chọn sau khi kiểm tra.</small></p></div>
          </div>
        </div>

        <div className="field full">
          <label htmlFor="mongo-uri">MongoDB connection string {requiredMark}</label>
          <div className="datasource-uri-control">
            <input
              id="mongo-uri"
              type={showUri ? "text" : "password"}
              value={uri}
              onChange={(event) => { setUri(event.target.value); resetMongoTest(); }}
              placeholder="mongodb+srv://<user>:<password>@cluster.mongodb.net/?retryWrites=true&w=majority"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="mongo-uri-hint"
            />
            <button type="button" className="button secondary datasource-uri-toggle" onClick={() => setShowUri((value) => !value)} aria-label={showUri ? "Ẩn MongoDB URI" : "Hiện MongoDB URI"}>{showUri ? "Ẩn" : "Hiện"}</button>
          </div>
          <small id="mongo-uri-hint" className="field-hint">Nếu password có ký tự đặc biệt như <code>@</code>, <code>#</code> hoặc <code>:</code>, hãy URL-encode trước khi dán URI.</small>
        </div>

        <div className="field">
          <label htmlFor="mongo-database">Database {requiredMark}</label>
          <input id="mongo-database" value={database} onChange={(event) => { setDatabase(event.target.value); resetMongoTest(); }} placeholder="Ví dụ: sample_mflix" autoComplete="off" spellCheck={false} />
          <small className="field-hint">Tên database thực tế trên cluster.</small>
        </div>

        {tested && collection && <div className="field full">
          <label htmlFor="mongo-filter">Filter JSON <span className="field-optional">tuỳ chọn</span></label>
          <textarea id="mongo-filter" value={filter} onChange={(event) => setFilter(event.target.value)} rows={3} placeholder={'{} hoặc {"status":"active"}'} spellCheck={false} aria-describedby="mongo-filter-hint" />
          <small id="mongo-filter-hint" className="field-hint">Để <code>{"{}"}</code> để đọc toàn bộ document trong collection.</small>
        </div>}
      </>}

      {kind === "duckdb" && <div className="field full">
        <label htmlFor="duckdb-path">Đường dẫn file DuckDB trên backend</label>
        <input id="duckdb-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="D:\\data\\warehouse.duckdb" />
      </div>}

      {kind !== "mongodb" && <div className="field">
        <label htmlFor="datasource-table">{objectLabel} (hoặc để trống nếu dùng query)</label>
        <input id="datasource-table" value={table} onChange={(event) => setTable(event.target.value)} />
      </div>}
      {kind !== "mongodb" && <div className="field full">
        <label htmlFor="datasource-query">Query SELECT (tuỳ chọn)</label>
        <textarea id="datasource-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SELECT * FROM orders WHERE created_at >= '2026-01-01'" rows={3} />
      </div>}
    </div>

    {tested && <Notice tone="success">
      <b>Kết nối thành công.</b>
      {kind === "mongodb" ? <>
        <p>{objects.length ? `${objects.length} collection khả dụng. Hãy chọn collection để tiếp tục.` : "Đã xác thực URI và database nhưng chưa tìm thấy collection nào."}</p>
        {!!objects.length && <div className="field">
          <label htmlFor="mongo-collection">Collection {requiredMark}</label>
          <select id="mongo-collection" value={collection} onChange={(event) => { setCollection(event.target.value); setError(null); }}>
            <option value="">Chọn collection…</option>
            {objects.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <small className="field-hint">Collection được lấy trực tiếp từ database vừa kiểm tra.</small>
        </div>}
      </> : <p>{objects.length ? `${objects.length} ${availableObjectLabel} khả dụng.` : `Đã xác thực datasource nhưng chưa tìm thấy ${availableObjectLabel} nào.`}</p>}
    </Notice>}

    {busy === "connect" && <ProgressSteps
      steps={saveOnly ? ["Kiểm tra", "Mã hoá", "Sẵn sàng"] : ["Kết nối", "Đọc metadata", "Bắt đầu profiling"]}
      activeStep={1}
      detail={saveOnly ? "Đang lưu connector dùng lại cho dataset…" : "Đang tạo dataset từ datasource…"}
    />}

    <div className="form-actions">
      <LoadingButton className="button secondary" busy={busy === "test"} disabled={busy !== null} onClick={handleTest}>{busy === "test" ? "Đang kiểm tra…" : "Kiểm tra kết nối"}</LoadingButton>
      <LoadingButton className="button primary" busy={busy === "connect"} disabled={busy !== null || !name.trim() || !mongoReadyToSave} onClick={handleConnect}>{busy === "connect" ? "Đang lưu…" : saveOnly ? "Lưu connector" : "Kết nối và profiling"}</LoadingButton>
    </div>
  </section>;
}

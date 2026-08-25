"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { connectDatasource, createProfile, testDatasource } from "@/lib/api";
import type { DatasourceConfig, DatasourceKind } from "@/lib/types";
import { ErrorNotice, LoadingButton, Notice, ProgressSteps } from "@/components/ui";

export function DatasourceConnector({ initialKind = "mysql", onBack }: { initialKind?: DatasourceKind; onBack?: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<DatasourceKind>(initialKind);
  const [name, setName] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("3306");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [uri, setUri] = useState("mongodb://localhost:27017");
  const [collection, setCollection] = useState("");
  const [filter, setFilter] = useState("{}");
  const [path, setPath] = useState("");
  const [table, setTable] = useState("");
  const [query, setQuery] = useState("");
  const [objects, setObjects] = useState<string[]>([]);
  const [busy, setBusy] = useState<"test" | "connect" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tested, setTested] = useState(false);

  function config(): DatasourceConfig {
    if (kind === "mysql") return { host, port: Number(port), user, password, database, ...(table ? { table } : {}), ...(query ? { query } : {}) };
    if (kind === "mongodb") return { uri, database, collection, filter };
    return { path, ...(table ? { table } : {}), ...(query ? { query } : {}) };
  }

  function switchKind(next: DatasourceKind) {
    setKind(next); setObjects([]); setTested(false); setError(null);
  }

  async function handleTest() {
    setBusy("test"); setError(null);
    try {
      const result = await testDatasource(kind, name || "Datasource", config());
      setObjects(result.objects);
      if (kind === "mongodb" && !collection && result.objects[0]) setCollection(result.objects[0]);
      if (kind !== "mongodb" && !table && result.objects[0]) setTable(result.objects[0]);
      setTested(true);
    } catch (reason) { setError(reason); } finally { setBusy(null); }
  }

  async function handleConnect() {
    if (!name.trim()) { setError(new Error("Hãy nhập tên dataset.")); return; }
    setBusy("connect"); setError(null);
    try {
      const connected = await connectDatasource(kind, name.trim(), config());
      const payload = { dataset_id: connected.dataset_id, dataset_name: connected.name, scan_mode: "sample" as const };
      const job = await createProfile(payload, crypto.randomUUID());
      router.push(`/profiles/${job.profiling_run_id}`);
    } catch (reason) { setError(reason); } finally { setBusy(null); }
  }

  const objectLabel = kind === "mongodb" ? "Collection" : "Bảng";
  return <section className="panel">
    {onBack && <div className="form-actions"><button type="button" className="button secondary" onClick={onBack}>Quay lại danh sách connectors</button></div>}
    <div className="panel-title"><h2>Kết nối datasource</h2><small>Nguồn được đọc theo từng lần profiling, credential được mã hóa phía backend.</small></div>
    {error ? <ErrorNotice error={error} retry={busy === null ? handleTest : undefined} /> : null}
    <div className="inline-actions" role="tablist" aria-label="Loại datasource">
      {(["mysql", "mongodb", "duckdb"] as DatasourceKind[]).map((item) => <button className={`button ${kind === item ? "primary" : "secondary"}`} key={item} type="button" onClick={() => switchKind(item)}>{item === "mongodb" ? "MongoDB" : item === "mysql" ? "MySQL" : "DuckDB"}</button>)}
    </div>
    <div className="form-grid">
      <div className="field full"><label htmlFor="datasource-name">Tên dataset</label><input id="datasource-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Đơn hàng production" maxLength={255} /></div>
      {kind === "mysql" && <><div className="field"><label htmlFor="mysql-host">Host</label><input id="mysql-host" value={host} onChange={(event) => setHost(event.target.value)} /></div><div className="field"><label htmlFor="mysql-port">Port</label><input id="mysql-port" type="number" value={port} onChange={(event) => setPort(event.target.value)} /></div><div className="field"><label htmlFor="mysql-user">User</label><input id="mysql-user" value={user} onChange={(event) => setUser(event.target.value)} /></div><div className="field"><label htmlFor="mysql-password">Password</label><input id="mysql-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></div><div className="field"><label htmlFor="mysql-database">Database</label><input id="mysql-database" value={database} onChange={(event) => setDatabase(event.target.value)} /></div></>}
      {kind === "mongodb" && <><div className="field full"><label htmlFor="mongo-uri">MongoDB URI</label><input id="mongo-uri" value={uri} onChange={(event) => setUri(event.target.value)} placeholder="mongodb://user:password@host:27017" /></div><div className="field"><label htmlFor="mongo-database">Database</label><input id="mongo-database" value={database} onChange={(event) => setDatabase(event.target.value)} /></div><div className="field"><label htmlFor="mongo-collection">Collection</label><input id="mongo-collection" value={collection} onChange={(event) => setCollection(event.target.value)} /></div><div className="field full"><label htmlFor="mongo-filter">Filter JSON (tùy chọn)</label><textarea id="mongo-filter" value={filter} onChange={(event) => setFilter(event.target.value)} rows={3} /></div></>}
      {kind === "duckdb" && <><div className="field full"><label htmlFor="duckdb-path">Đường dẫn file DuckDB trên backend</label><input id="duckdb-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="D:\data\warehouse.duckdb" /></div></>}
      {kind !== "mongodb" && <div className="field"><label htmlFor="datasource-table">{objectLabel} (hoặc để trống nếu dùng query)</label><input id="datasource-table" value={table} onChange={(event) => setTable(event.target.value)} /></div>}
      {kind !== "mongodb" && <div className="field full"><label htmlFor="datasource-query">Query SELECT (tùy chọn)</label><textarea id="datasource-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SELECT * FROM orders WHERE created_at >= '2026-01-01'" rows={3} /></div>}
    </div>
    {!!objects.length && <Notice tone="success"><b>Kết nối thành công.</b><p>{objects.length} {kind === "mongodb" ? "collection" : "bảng"} khả dụng. {tested ? "Bạn có thể chọn một đối tượng rồi bắt đầu profiling." : ""}</p><select value={kind === "mongodb" ? collection : table} onChange={(event) => kind === "mongodb" ? setCollection(event.target.value) : setTable(event.target.value)}><option value="">Chọn {objectLabel.toLowerCase()}…</option>{objects.map((item) => <option key={item} value={item}>{item}</option>)}</select></Notice>}
    {busy === "connect" && <ProgressSteps steps={["Kết nối", "Đọc metadata", "Bắt đầu profiling"]} activeStep={1} detail="Đang tạo dataset từ datasource…" />}
    <div className="form-actions"><LoadingButton className="button secondary" busy={busy === "test"} disabled={busy !== null} onClick={handleTest}>{busy === "test" ? "Đang kiểm tra…" : "Kiểm tra kết nối"}</LoadingButton><LoadingButton className="button primary" busy={busy === "connect"} disabled={busy !== null || !name.trim()} onClick={handleConnect}>{busy === "connect" ? "Đang bắt đầu…" : "Kết nối và profiling"}</LoadingButton></div>
  </section>;
}

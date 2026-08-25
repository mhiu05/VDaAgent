"use client";

import { useState } from "react";
import { DatasourceConnector } from "@/components/datasource-connector";
import { PageHeader } from "@/components/ui";
import type { DatasourceKind } from "@/lib/types";

const connectors: Array<{ kind: DatasourceKind; title: string; description: string; detail: string }> = [
  { kind: "mysql", title: "MySQL", description: "Kết nối cơ sở dữ liệu quan hệ MySQL.", detail: "Host, port, database, user và bảng hoặc query SELECT." },
  { kind: "mongodb", title: "MongoDB", description: "Đọc dữ liệu từ collection MongoDB.", detail: "MongoDB URI, database, collection và filter JSON tùy chọn." },
  { kind: "duckdb", title: "DuckDB", description: "Kết nối file DuckDB có sẵn trên backend.", detail: "Đường dẫn file .duckdb/.db và bảng hoặc query SELECT." },
];

export default function ConnectorsPage() {
  const [selected, setSelected] = useState<DatasourceKind | null>(null);
  const selectedConnector = connectors.find((connector) => connector.kind === selected);

  return <>
    <PageHeader
      eyebrow="Data connectors"
      title="Kết nối nguồn dữ liệu"
      description="Chọn một connector để cấu hình nguồn dữ liệu. Credential được xử lý ở backend và không hiển thị lại sau khi lưu."
    />
    {!selected && <section className="grid two" aria-label="Danh sách connectors">
      {connectors.map((connector) => <button className="panel" type="button" key={connector.kind} onClick={() => setSelected(connector.kind)} style={{ textAlign: "left", cursor: "pointer" }}>
        <div className="panel-title"><h2>{connector.title}</h2><span className="badge">{connector.kind}</span></div>
        <p>{connector.description}</p>
        <small className="muted">{connector.detail}</small>
        <div className="form-actions"><span className="button secondary">Cấu hình connector →</span></div>
      </button>)}
    </section>}
    {selectedConnector && <DatasourceConnector key={selectedConnector.kind} initialKind={selectedConnector.kind} onBack={() => setSelected(null)} />}
  </>;
}

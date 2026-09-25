'use client';

import { FileSpreadsheet, Upload } from 'lucide-react';
import { useImports } from '../hooks/use-imports';
import { dateTime } from '../../../lib/format/date-time';
import { EmptyState } from '../../../components/feedback/empty-state';
import { Button } from '../../../components/ui';

export function ImportsPanel({
  orgId,
  canWrite,
  onImported,
}: {
  orgId: string;
  canWrite: boolean;
  onImported: () => Promise<void>;
}) {
  const { imports, csv, source, setSource, busy, error, success, loading, submit, selectFile } =
    useImports(orgId, onImported);
  return (
    <div className="result-stack">
      <section className="card">
        <header className="section-heading">
          <div>
            <span className="eyebrow">NHẬP ẢNH CHỤP DỮ LIỆU</span>
            <h2>Nhập dữ liệu CSV</h2>
          </div>
          <FileSpreadsheet size={23} className="muted" />
        </header>
        <p className="muted">
          Toàn bộ tệp được kiểm tra trước khi lưu. Mỗi lần nhập có manifest và SHA-256 để truy vết.
        </p>
        {!canWrite && (
          <p className="notice">
            Vai trò viewer chỉ được xem dữ liệu. Cần owner hoặc analyst để nhập CSV.
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="import-grid">
            <label className="upload-zone">
              <Upload size={25} />
              <strong>Chọn snapshot CSV</strong>
              <span>UTF-8 · Tối đa 2 MB</span>
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="Chọn tệp CSV"
                disabled={!canWrite || busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  selectFile(file);
                }}
              />
            </label>
            <div>
              <label>
                Tên nguồn
                <input
                  value={source}
                  maxLength={200}
                  required
                  disabled={!canWrite || busy}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="inventory-snapshot.csv"
                />
              </label>
              <p className="muted small">
                Trạng thái hợp lệ: available, reserved, sold, held, unknown. Ô thiếu được giữ là
                null.
              </p>
              <Button
                type="submit"
                disabled={!canWrite || busy || !csv || !source}
              >
                <Upload size={16} />
                {busy ? 'Đang kiểm tra…' : 'Kiểm tra & nhập dữ liệu'}
              </Button>
            </div>
          </div>
          <details>
            <summary>Các cột CSV v1 bắt buộc</summary>
            <code className="csv-columns">
              snapshot_date, market_external_id, market_name, project_external_id, project_name,
              zone_external_id, zone_name, unit_external_id, unit_code, unit_type, area_sqm,
              list_price, currency, status, available_since, sold_at
            </code>
          </details>
        </form>
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="notice success">
            {success}
          </p>
        )}
      </section>
      <section className="card">
        <header className="section-heading">
          <div>
            <span className="eyebrow">DANH MỤC NGUỒN</span>
            <h2>Nguồn dữ liệu đã nhập</h2>
          </div>
        </header>
        {loading ? (
          <p role="status">Đang tải nguồn dữ liệu…</p>
        ) : imports.length ? (
          imports.map((item) => (
            <details className="import-record" key={item.import_id}>
              <summary>
                <strong>{item.source_name}</strong>
                <span>
                  {item.row_count} dòng · {dateTime(item.created_at)}
                </span>
              </summary>
              <dl className="metadata-list">
                <dt>Mã lượt nhập</dt>
                <dd>
                  <code>{item.import_id}</code>
                </dd>
                <dt>SHA-256 của tệp</dt>
                <dd>
                  <code>{item.file_hash}</code>
                </dd>
                <dt>Phiên bản lược đồ</dt>
                <dd>{item.schema_version}</dd>
              </dl>
            </details>
          ))
        ) : (
          <EmptyState title="Chưa có nguồn dữ liệu">Nhập CSV để bắt đầu tạo snapshot.</EmptyState>
        )}
      </section>
    </div>
  );
}

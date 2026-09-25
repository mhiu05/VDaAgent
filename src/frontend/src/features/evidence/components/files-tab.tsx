import { Database, LoaderCircle } from 'lucide-react';
import { dateTime } from '../../../lib/format/date-time';
import { EmptyState, type ArtifactList } from './tab-primitives';
import styles from './context-evidence-panel.module.css';

export function FilesTab({
  noRun,
  unavailable,
  loading,
  artifactsUnavailable,
  sources,
}: {
  noRun: boolean;
  unavailable: boolean;
  loading: boolean;
  artifactsUnavailable: boolean;
  sources: ArtifactList['sources'];
}) {
  if (noRun)
    return (
      <EmptyState icon={Database} title="Chưa có tệp nguồn trong bối cảnh">
        Chọn một lượt chạy đã lưu để xem metadata của các nguồn dữ liệu được tham chiếu.
      </EmptyState>
    );
  if (unavailable || artifactsUnavailable)
    return (
      <EmptyState icon={Database} title="Metadata nguồn không khả dụng">
        Chỉ hiển thị bản ghi nguồn sau khi quyền truy cập lượt chạy được xác thực.
      </EmptyState>
    );
  if (loading)
    return (
      <EmptyState icon={LoaderCircle} title="Đang tải metadata nguồn">
        Đang lấy danh sách nguồn dữ liệu liên quan đến lượt chạy này.
      </EmptyState>
    );
  if (!sources.length)
    return (
      <EmptyState icon={Database} title="Chưa có nguồn dữ liệu được liệt kê">
        Không có metadata nhập dữ liệu nào được trả về cho lượt chạy này.
      </EmptyState>
    );

  return (
    <ul className={styles.fileList} aria-label="Nguồn dữ liệu đã nhập">
      {sources.map((source) => (
        <li key={source.import_id}>
          <Database size={16} aria-hidden={true} />
          <div>
            <strong>{source.source_name}</strong>
            <span>
              {source.row_count.toLocaleString('vi-VN')} dòng · nhập lúc {dateTime(source.created_at)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

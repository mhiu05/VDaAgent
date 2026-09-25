import type { Artifact, ArtifactValidation, ImportManifest } from '@vda/contracts';
import { resolveEvidencePath } from '../evidence-path';
import { dateTime } from '../../../lib/format/date-time';

export function EvidenceDetail({ artifact, validation, artifacts, sources, path, onSelect }: {
  artifact: Artifact;
  validation: ArtifactValidation | null;
  artifacts: Artifact[];
  sources: ImportManifest[];
  path: string | null;
  onSelect: (id: string) => void;
}) {
  const resolved = path ? resolveEvidencePath(artifact, path) : null;
  return <section aria-label="Chi tiết bằng chứng">
    <h3>{artifact.kind.replaceAll('_', ' ')}</h3>
    <dl className="metadata-list">
      <dt>Artifact ID</dt><dd><code>{artifact.artifact_id}</code></dd>
      <dt>Run ID</dt><dd><code>{artifact.run_id}</code></dd>
      <dt>Task ID</dt><dd><code>{artifact.task_id}</code></dd>
      <dt>Phiên bản schema</dt><dd><code>{artifact.schema_version}</code></dd>
      <dt>Phiên bản ngữ nghĩa</dt><dd><code>{artifact.semantic_version}</code></dd>
      <dt>Ngày dữ liệu</dt><dd>{artifact.data_as_of}</dd>
      <dt>Tạo lúc</dt><dd>{dateTime(artifact.created_at)}</dd>
      <dt>Hash nội dung</dt><dd><code>{artifact.content_hash}</code></dd>
    </dl>
    <p>{validation?.valid ? 'Đã xác thực' : 'Chưa có xác nhận hợp lệ'}</p>
    {validation && <ul>{validation.checks.map((check) => <li key={check}>{check}</li>)}</ul>}
    {path && <div>
      <h4>Đường dẫn bằng chứng</h4><code>{path}</code>
      <h4>Giá trị tại đường dẫn</h4>
      {resolved?.available ? <pre>{JSON.stringify(resolved.value, null, 2) ?? 'null'}</pre> : <p>Không thể xác định giá trị tại đường dẫn này.</p>}
    </div>}
    <details><summary>Đầu vào ({artifact.input_refs.length})</summary>
      <ul>{artifact.input_refs.map((id) => <li key={id}>
        <button type="button" disabled={!artifacts.some((item) => item.artifact_id === id)} onClick={() => onSelect(id)}>{artifacts.find((item) => item.artifact_id === id)?.kind ?? 'Hiện vật không khả dụng'}</button>
        <code>{id}</code>
      </li>)}</ul>
    </details>
    <details><summary>Snapshot ({artifact.snapshot_refs.length})</summary><pre>{artifact.snapshot_refs.join('\n') || 'Không có'}</pre></details>
    <details><summary>Nguồn dữ liệu ({artifact.source_refs.length})</summary>
      {artifact.source_refs.map((id) => {
        const source = sources.find((item) => item.import_id === id);
        return <div key={id}><code>{id}</code>{source && <>
          <p>{source.source_name} · {source.row_count} dòng nguồn · {source.schema_version}</p>
          <code>{source.file_hash}</code>
        </>}</div>;
      })}
    </details>
    {artifact.limitations.length > 0 && <details><summary>Giới hạn</summary><ul>{artifact.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>}
    <details><summary>Payload gốc</summary><pre>{JSON.stringify(artifact.payload, null, 2)}</pre></details>
  </section>;
}

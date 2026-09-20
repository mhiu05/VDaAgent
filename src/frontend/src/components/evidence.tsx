'use client';

import { useEffect, useRef } from 'react';
import { ArrowUpRight, CheckCircle2, Database, Fingerprint, Link2, X } from 'lucide-react';
import type { Artifact, ArtifactValidation, ImportManifest } from '@vda/contracts';
import { dateTime } from '../lib/client-api';

export function EvidenceDrawer({
  artifact,
  artifacts,
  validations,
  sources,
  onSelect,
  onClose,
}: {
  artifact: Artifact;
  artifacts: Artifact[];
  validations: ArtifactValidation[];
  sources: ImportManifest[];
  onSelect: (artifactId: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const validation = validations.find((item) => item.artifact_id === artifact.artifact_id);
  return (
    <dialog
      ref={dialog}
      className="evidence-dialog"
      aria-labelledby="evidence-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="drawer-body">
        <header className="section-heading">
          <div>
            <span className="eyebrow">EVIDENCE EXPLORER</span>
            <h2 id="evidence-title">Bằng chứng & nguồn gốc</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Đóng bằng chứng">
            <X size={20} />
          </button>
        </header>
        <div className="evidence-kind">
          <Database size={20} />
          <strong>{artifact.kind}</strong>
          <span className="badge">Immutable</span>
        </div>
        <dl className="metadata-list">
          <dt>Artifact ID</dt>
          <dd>
            <code>{artifact.artifact_id}</code>
          </dd>
          <dt>Run ID</dt>
          <dd>
            <code>{artifact.run_id}</code>
          </dd>
          <dt>Task ID</dt>
          <dd>
            <code>{artifact.task_id}</code>
          </dd>
          <dt>Ngày dữ liệu</dt>
          <dd>{artifact.data_as_of}</dd>
          <dt>Semantic version</dt>
          <dd>{artifact.semantic_version}</dd>
          <dt>Tạo lúc</dt>
          <dd>{dateTime(artifact.created_at)}</dd>
        </dl>
        <div className={`notice ${validation?.valid ? 'success' : ''}`}>
          <CheckCircle2 size={17} />
          <div>
            <strong>
              {validation?.valid ? 'Đã kiểm tra bằng chứng' : 'Chưa có xác nhận validation'}
            </strong>
            {validation && <p>{validation.checks.join(' · ')}</p>}
          </div>
        </div>
        <h3>
          <Link2 size={17} /> Chuỗi truy vết
        </h3>
        <p className="muted">
          Đi ngược các đầu vào để xem phép tính, kết quả truy vấn và dữ liệu nguồn.
        </p>
        <div className="lineage-links">
          {artifact.input_refs.length ? (
            artifact.input_refs.map((id) => {
              const input = artifacts.find((item) => item.artifact_id === id);
              return (
                <button
                  key={id}
                  className="lineage-link"
                  disabled={!input}
                  onClick={() => onSelect(id)}
                >
                  <span>
                    <strong>{input?.kind ?? 'Artifact chưa tải'}</strong>
                    <code>{id}</code>
                  </span>
                  <ArrowUpRight size={18} />
                </button>
              );
            })
          ) : (
            <p className="muted">Điểm bắt đầu của chuỗi dữ liệu.</p>
          )}
        </div>
        <details>
          <summary>Snapshot tham chiếu ({artifact.snapshot_refs.length})</summary>
          <pre>{artifact.snapshot_refs.join('\n') || 'Không có snapshot tham chiếu.'}</pre>
        </details>
        <h3>
          <Database size={17} /> Nguồn dữ liệu
        </h3>
        {artifact.source_refs.map((id) => {
          const source = sources.find((item) => item.import_id === id);
          return (
            <div className="source-card" key={id}>
              <strong>{source?.source_name ?? id}</strong>
              <code>{id}</code>
              {source && (
                <>
                  <p>
                    {source.row_count} dòng · {source.schema_version} ·{' '}
                    {dateTime(source.created_at)}
                  </p>
                  <span className="muted">SHA-256 của tệp</span>
                  <code>{source.file_hash}</code>
                </>
              )}
            </div>
          );
        })}
        {!artifact.source_refs.length && (
          <p className="muted">Artifact này chưa tham chiếu nguồn.</p>
        )}
        <h3>
          <Fingerprint size={17} /> Hash nội dung
        </h3>
        <code className="hash">{artifact.content_hash}</code>
        <details className="payload">
          <summary>Payload gốc</summary>
          <pre>{JSON.stringify(artifact.payload, null, 2)}</pre>
        </details>
        <div className="notice">
          <div>
            <strong>Assumption / MVP provisional</strong>
            {artifact.limitations.map((text, index) => (
              <p key={index}>{text}</p>
            ))}
          </div>
        </div>
      </section>
    </dialog>
  );
}

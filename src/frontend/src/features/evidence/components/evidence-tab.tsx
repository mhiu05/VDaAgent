import { FileCheck2, LoaderCircle, ShieldCheck } from 'lucide-react';
import { dateTime } from '../../../lib/format/date-time';
import type { WorkspaceContextState } from '../../workspace/context';
import { EmptyState, label, type ArtifactList } from './tab-primitives';
import styles from './context-evidence-panel.module.css';

export function EvidenceTab({
  noRun,
  unavailable,
  loading,
  artifactsUnavailable,
  artifacts,
  validations,
  selectedArtifact,
  selectedValidation,
  context,
}: {
  noRun: boolean;
  unavailable: boolean;
  loading: boolean;
  artifactsUnavailable: boolean;
  artifacts: ArtifactList['artifacts'];
  validations: ArtifactList['validations'];
  selectedArtifact: ArtifactList['artifacts'][number] | null;
  selectedValidation: ArtifactList['validations'][number] | null;
  context: WorkspaceContextState;
}) {
  if (noRun)
    return (
      <EmptyState icon={ShieldCheck} title="Chưa chọn bằng chứng">
        Bằng chứng luôn gắn với lượt phân tích đã lưu và không được tự tạo trên giao diện.
      </EmptyState>
    );
  if (unavailable)
    return (
      <EmptyState icon={ShieldCheck} title="Bằng chứng không khả dụng">
        Workspace này không thể truy cập lượt chạy đã chọn.
      </EmptyState>
    );
  if (loading)
    return (
      <EmptyState icon={LoaderCircle} title="Đang tải bằng chứng">
        Đang kiểm tra lượt chạy và metadata hiện vật được phép truy cập.
      </EmptyState>
    );
  if (artifactsUnavailable)
    return (
      <EmptyState icon={ShieldCheck} title="Metadata hiện vật không khả dụng">
        Lượt chạy vẫn được chọn nhưng chưa tải được danh mục bằng chứng.
      </EmptyState>
    );
  if (!artifacts.length)
    return (
      <EmptyState icon={ShieldCheck} title="Không có bằng chứng được phép xem">
        Vai trò hiện tại không có metadata bằng chứng cho lượt chạy này.
      </EmptyState>
    );

  return (
    <div className={styles.stack}>
      {selectedArtifact && (
        <section className={styles.selectedArtifact} aria-label="Bằng chứng đang chọn">
          <span className={styles.sectionLabel}>Bằng chứng đang chọn</span>
          <strong>{label(selectedArtifact.kind)}</strong>
          <span
            className={styles.validation}
            data-valid={selectedValidation?.valid ? 'true' : 'false'}
          >
            {selectedValidation?.valid ? 'Đã xác thực' : 'Chưa có kết quả xác thực'}
          </span>
          {context.active_evidence_ref?.evidence_path && (
            <code title={context.active_evidence_ref.evidence_path}>
              {context.active_evidence_ref.evidence_path}
            </code>
          )}
        </section>
      )}
      <ul className={styles.artifactList} aria-label="Các hiện vật bằng chứng khả dụng">
        {artifacts.map((artifact) => {
          const validation = validations.find((item) => item.artifact_id === artifact.artifact_id);
          return (
            <li
              key={artifact.artifact_id}
              data-selected={artifact.artifact_id === context.active_artifact_id ? 'true' : 'false'}
            >
              <FileCheck2 size={15} aria-hidden={true} />
              <div>
                <strong>{label(artifact.kind)}</strong>
                <span>
                  {validation?.valid
                    ? `Đã vượt qua ${validation.checks.length} bước kiểm tra`
                    : 'Metadata xác thực không khả dụng'}
                </span>
              </div>
              <time dateTime={artifact.created_at}>{dateTime(artifact.created_at)}</time>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

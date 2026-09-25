import type { ReactNode } from 'react';
import { z } from 'zod';
import { ArtifactListSchema, RunDetailSchema } from '@vda/contracts';
import type { LucideIcon } from 'lucide-react';
import styles from './context-evidence-panel.module.css';

export type RunDetail = z.infer<typeof RunDetailSchema>;
export type ArtifactList = z.infer<typeof ArtifactListSchema>;

export function label(value: string) {
  return value.replaceAll('_', ' ');
}

export function scopeLabel(detail: RunDetail) {
  const { project_external_id, zone_external_id } = detail.run.request.scope;
  return zone_external_id ? `${project_external_id} / ${zone_external_id}` : project_external_id;
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <Icon size={18} aria-hidden={true} />
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function DetailRow({ label: rowLabel, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.detailRow}>
      <dt>{rowLabel}</dt>
      <dd>{children}</dd>
    </div>
  );
}

import type { CSSProperties, ReactNode } from 'react';
import { MascotAvatar } from './assistant-avatar';
import { assistantStateDetails, type AssistantState } from './assistant-state';
import styles from './assistant.module.css';

export type AssistantPresenceProps = {
  state?: AssistantState;
  label?: string;
  description?: string;
  action?: ReactNode;
  avatarSize?: number | string;
  className?: string;
  style?: CSSProperties;
  announce?: boolean;
};

export function AssistantPresence({
  state = 'idle',
  label,
  description,
  action,
  avatarSize = 40,
  className,
  style,
  announce = false,
}: AssistantPresenceProps) {
  const details = assistantStateDetails[state];

  return (
    <div
      aria-atomic={announce || undefined}
      aria-live={announce ? 'polite' : undefined}
      className={[styles.presence, className].filter(Boolean).join(' ')}
      data-assistant-state={state}
      role={announce ? 'status' : undefined}
      style={style}
    >
      <MascotAvatar decorative size={avatarSize} state={state} />
      <div className={styles.presenceCopy}>
        <strong>{label ?? details.label}</strong>
        <span>{description ?? details.description}</span>
      </div>
      {action && <div className={styles.presenceAction}>{action}</div>}
    </div>
  );
}

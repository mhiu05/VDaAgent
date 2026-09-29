'use client';

import type { CSSProperties } from 'react';
import { useState } from 'react';
import Image from 'next/image';
import { Check, CircleAlert, Clock3, FileText, LoaderCircle, Search, Sparkles } from 'lucide-react';
import { assistantStateDetails, type AssistantState } from './assistant-state';
import styles from './assistant.module.css';

type StatusIcon = typeof Check;

const stateIcons: Record<AssistantState, StatusIcon> = {
  idle: Sparkles,
  thinking: LoaderCircle,
  analyzing: Search,
  happy: Sparkles,
  success: Check,
  warning: CircleAlert,
  error: CircleAlert,
  waiting: Clock3,
  'report-ready': FileText,
};

export type MascotAvatarProps = {
  state?: AssistantState;
  size?: number | string;
  label?: string;
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function MascotAvatar({
  state = 'idle',
  size = 40,
  label,
  decorative = false,
  className,
  style,
}: MascotAvatarProps) {
  const [imageAvailable, setImageAvailable] = useState(true);
  const StatusIcon = stateIcons[state];
  const accessibleLabel = label ?? `VDa Navigator: ${assistantStateDetails[state].label}`;

  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : accessibleLabel}
      className={[styles.avatar, className].filter(Boolean).join(' ')}
      data-assistant-state={state}
      role={decorative ? undefined : 'img'}
      style={{ width: size, height: size, ...style }}
    >
      {imageAvailable ? (
        <Image
          alt=""
          className={styles.image}
          height={256}
          src="/brand/mascot/navigator-avatar.webp"
          width={256}
          sizes="(max-width: 720px) 40px, 48px"
          onError={() => setImageAvailable(false)}
        />
      ) : (
        <span className={styles.fallback} aria-hidden="true">
          <Sparkles size={Math.max(typeof size === 'number' ? Math.round(size * 0.42) : 17, 14)} />
        </span>
      )}
      <span className={styles.stateMarker} aria-hidden="true">
        <StatusIcon size={Math.max(typeof size === 'number' ? Math.round(size * 0.25) : 10, 9)} />
      </span>
    </span>
  );
}

/** Kept as a compatibility alias for existing feature imports. */
export const AssistantAvatar = MascotAvatar;
export type AssistantAvatarProps = MascotAvatarProps;

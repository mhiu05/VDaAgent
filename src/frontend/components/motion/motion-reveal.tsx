'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';

gsap.registerPlugin(useGSAP);

export type MotionRevealProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** Delay in seconds. */
  delay?: number;
  /** Duration in seconds. */
  duration?: number;
  /** Vertical offset in pixels at the start of the reveal. */
  distance?: number;
  /** Subtle initial scale for the reveal. */
  scale?: number;
  ease?: string;
};

/**
 * A mount-only, root-scoped reveal. It intentionally has no global selectors
 * and does not animate when the operating system requests reduced motion.
 */
export function MotionReveal({
  children,
  delay = 0,
  duration = 0.42,
  distance = 12,
  scale = 0.985,
  ease = 'power2.out',
  ...props
}: MotionRevealProps) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!root.current) return;

      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          root.current,
          { scale, y: distance },
          { delay, duration, ease, scale: 1, y: 0 },
        );
      });

      return () => media.revert();
    },
    {
      dependencies: [delay, distance, duration, ease, scale],
      revertOnUpdate: true,
      scope: root,
    },
  );

  return (
    <div ref={root} {...props}>
      {children}
    </div>
  );
}

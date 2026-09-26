'use client';

import Image from 'next/image';
import { FileText } from 'lucide-react';

export function EmptyState({
  title,
  children,
  illustration = false,
}: {
  title: string;
  children: React.ReactNode;
  illustration?: boolean;
}) {
  return (
    <div className="empty-state">
      {illustration ? (
        <Image
          className="empty-illustration"
          src="/brand/mascot/navigator-welcome-small.webp"
          alt=""
          width={256}
          height={308}
          sizes="96px"
        />
      ) : (
        <span className="empty-icon" aria-hidden="true">
          <LayersIcon />
        </span>
      )}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function LayersIcon() {
  return <FileText size={26} strokeWidth={1.5} />;
}

'use client';

import { FileText } from 'lucide-react';


export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <LayersIcon />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function LayersIcon() {
  return <FileText size={26} strokeWidth={1.5} />;
}

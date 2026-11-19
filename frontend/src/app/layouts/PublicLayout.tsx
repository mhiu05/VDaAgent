import type { ReactNode } from "react";
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="public-layout">
      {children}
    </main>
  );
}

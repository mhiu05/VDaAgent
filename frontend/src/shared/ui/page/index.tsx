import type { ReactNode } from "react";
export function PageFrame({
  title,
  actions,
  width = "reading",
  children,
}: {
  title: string;
  actions?: ReactNode;
  width?: "reading" | "wide";
  children: ReactNode;
}) {
  return (
    <div className={`page-frame ${width}`}>
      <header className="page-heading">
        <div>
          <h1 tabIndex={-1}>{title}</h1>
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}
export function ViewportFrame({
  label,
  header,
  body,
  footer,
}: {
  label: string;
  header: ReactNode;
  body: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="viewport-frame">
      <h1 className="sr-only">{label}</h1>
      {header}
      <div className="viewport-body">{body}</div>
      {footer}
    </section>
  );
}
export function PageState({
  kind,
  title,
  description,
  action,
  headingLevel = 2,
}: {
  kind: "loading" | "empty" | "error" | "unauthorized";
  title: string;
  description?: string;
  action?: ReactNode;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div
      className="page-state"
      role={kind === "error" ? "alert" : undefined}
      aria-busy={kind === "loading" || undefined}
    >
      <Heading>{title}</Heading>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="stack">
      <h2>{title}</h2>
      {description && <p className="muted">{description}</p>}
    </header>
  );
}

import type { ReactNode } from "react";
export function StatusBadge({
  tone = "neutral",
  label,
}: {
  tone?: "neutral" | "success" | "warning" | "danger";
  label: string;
}) {
  return <span className={`badge badge-${tone}`}>{label}</span>;
}
export function TableSurface({
  caption,
  header,
  children,
  empty,
}: {
  caption: string;
  header: ReactNode;
  children?: ReactNode;
  empty?: ReactNode;
}) {
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table>
        <caption>{caption}</caption>
        <thead>{header}</thead>
        <tbody>{children}</tbody>
      </table>
      {empty}
    </div>
  );
}
export function TableToolbar({ children }: { children: ReactNode }) {
  return <div className="row spread">{children}</div>;
}
export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange(page: number): void;
  previousLabel: string;
  nextLabel: string;
  label: string;
}
export function Pagination({
  page,
  pageCount,
  onPageChange,
  previousLabel,
  nextLabel,
  label,
}: PaginationProps) {
  return (
    <nav aria-label={label} className="row">
      <button
        className="button button-secondary"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {previousLabel}
      </button>
      <span>
        {page} / {pageCount}
      </span>
      <button
        className="button button-secondary"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        {nextLabel}
      </button>
    </nav>
  );
}
export function ChartFrame({
  title,
  unit,
  scope,
  summary,
  actions,
  motion,
  children,
}: {
  title: string;
  unit: string;
  scope: string;
  summary: string;
  actions?: ReactNode;
  motion?: "panel";
  children: ReactNode;
}) {
  return (
    <figure className="chart-frame" data-motion={motion}>
      <figcaption>
        <div className="chart-frame-heading">
          <h3>{title}</h3>
          {actions}
        </div>
        <p>
          {scope} · {unit}
        </p>
        {summary ? <p className="chart-frame-description">{summary}</p> : null}
      </figcaption>
      {children}
    </figure>
  );
}

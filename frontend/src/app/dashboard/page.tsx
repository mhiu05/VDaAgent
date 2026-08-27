"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { PERMISSIONS, can } from "@/lib/auth/permissions";
import { getDashboard } from "@/lib/api";

type Dashboard = {
  kind: "analyst";
  reports?: Array<{ id: string; title: string; status: string }>;
  counts?: Record<string, number>;
};

const countMeta: Record<string, { label: string; description: string; icon: string }> = {
  datasets: { label: "B\u1ed9 d\u1eef li\u1ec7u", description: "ngu\u1ed3n \u0111\u00e3 t\u1ea3i l\u00ean", icon: "\u25a6" },
  profiles: { label: "Profile", description: "l\u1ea7n ki\u1ec3m tra d\u1eef li\u1ec7u", icon: "\u25cc" },
  analyses: { label: "Ph\u00e2n t\u00edch", description: "phi\u00ean c\u00f3 evidence", icon: "\u2301" },
  reports: { label: "B\u00e1o c\u00e1o", description: "b\u1ea3n \u0111\u00e3 xu\u1ea5t b\u1ea3n", icon: "\u25a4" },
};

const roleCopy = {
  eyebrow: "Analyst workspace",
  title: "S\u1eb5n s\u00e0ng ph\u00e2n t\u00edch",
  description: "B\u1eaft \u0111\u1ea7u b\u1eb1ng c\u00e1ch t\u1ea3i d\u1eef li\u1ec7u l\u00ean, sau \u0111\u00f3 profile, review metadata v\u00e0 ph\u00e2n t\u00edch d\u1ef1a tr\u00ean evidence.",
};

const reportStatusLabel: Record<string, string> = {
  draft: "B\u1ea3n nh\u00e1p",
  in_review: "\u0110\u00e3 xu\u1ea5t b\u1ea3n",
  published: "\u0110\u00e3 xu\u1ea5t b\u1ea3n",
  archived: "\u0110\u00e3 l\u01b0u tr\u1eef",
};

export default function DashboardPage() {
  const { me, loading, error } = useAuth();
  const dashboard = useQuery({
    queryKey: ["dashboard", me?.workspace?.id],
    queryFn: () => getDashboard<Dashboard>(),
    enabled: Boolean(me),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
  });

  if (loading) return <main className="dashboard-page"><section className="dashboard-loading" aria-live="polite"><span className="dashboard-loading-mark" aria-hidden="true" /><div><b>{"\u0110ang m\u1edf workspace..."}</b><p>{"\u0110ang chu\u1ea9n b\u1ecb d\u1eef li\u1ec7u v\u00e0 quy\u1ec1n truy c\u1eadp."}</p></div></section></main>;
  if (error) return <main className="page"><h1>{"Kh\u00f4ng th\u1ec3 m\u1edf workspace"}</h1><p>{error}</p><Link href="/">{"V\u1ec1 trang ch\u1ee7"}</Link></main>;
  if (!me) return null;
  if (dashboard.isPending) return <main className="dashboard-page"><section className="dashboard-loading" aria-live="polite"><span className="dashboard-loading-mark" aria-hidden="true" /><div><b>{"\u0110ang t\u1ea3i d\u1eef li\u1ec7u workspace..."}</b><p>{"Ch\u1ec9 m\u1ea5t m\u1ed9t ch\u00fat th\u1eddi gian."}</p></div></section></main>;
  if (dashboard.isError) return <main className="page"><p>{dashboard.error.message}</p></main>;

  const data = dashboard.data;
  const counts = Object.entries(data.counts ?? {});

  return <main className="dashboard-page">
    <header className="dashboard-header">
      <div><p className="eyebrow">{roleCopy.eyebrow}</p><h1>{roleCopy.title}</h1><p>{roleCopy.description}</p></div>
      {can(me.effective_permissions, PERMISSIONS.datasetUpload) && <Link href="/datasets/new" className="button primary">{"T\u1ea3i d\u1eef li\u1ec7u l\u00ean"} <span aria-hidden="true">→</span></Link>}
    </header>

    {counts.length > 0 && <section aria-labelledby="workspace-overview"><div className="dashboard-section-heading"><div><p className="eyebrow">{"T\u1ed5ng quan"}</p><h2 id="workspace-overview">{"Ti\u1ebfn \u0111\u1ed9 workspace"}</h2></div><small>{"C\u1eadp nh\u1eadt theo workspace hi\u1ec7n t\u1ea1i"}</small></div><dl className="dashboard-stats-grid">{counts.map(([key, value]) => {
      const meta = countMeta[key] ?? { label: key, description: "m\u1ee5c trong workspace", icon: "•" };
      return <div className="dashboard-stat-card" key={key}><div className="dashboard-stat-icon" aria-hidden="true">{meta.icon}</div><div><dt>{meta.label}</dt><dd>{value}</dd><small>{meta.description}</small></div></div>;
    })}</dl></section>}

    <section className="dashboard-reports panel">
      <div><p className="eyebrow">{"B\u00e1o c\u00e1o"}</p><h2>{"B\u00e1o c\u00e1o \u0111\u00e3 xu\u1ea5t b\u1ea3n"}</h2></div>
      {data.reports?.length ? (
        <ul>{data.reports.map((report) => <li key={report.id}><Link href={`/reports/${report.id}`}>{report.title}</Link><small>{reportStatusLabel[report.status] || reportStatusLabel.published}</small></li>)}</ul>
      ) : (
        <div className="dashboard-empty"><span aria-hidden="true">✦</span><div><b>{"Ch\u01b0a c\u00f3 b\u00e1o c\u00e1o"}</b><p>{"T\u1ea3i dataset \u0111\u1ea7u ti\u00ean \u0111\u1ec3 b\u1eaft \u0111\u1ea7u t\u1ea1o evidence v\u00e0 xu\u1ea5t b\u00e1o c\u00e1o."}</p></div></div>
      )}
    </section>
  </main>;
}

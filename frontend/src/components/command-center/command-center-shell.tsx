"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useId, useRef } from "react";
import { getProfile } from "@/lib/api";
import { COMMAND_CENTER_TAB_LABELS, COMMAND_CENTER_TABS, isCommandCenterTab, type CommandCenterTab } from "@/lib/command-center-types";
import { ErrorNotice, LoadingBlock, Notice, StatusBadge } from "@/components/ui";

const ExplorerTab = dynamic(() => import("./explorer-tab").then((module) => module.ExplorerTab), { loading: () => <LoadingBlock label="Đang mở Explorer…" /> });
const ChartsTab = dynamic(() => import("./charts-tab").then((module) => module.ChartsTab), { loading: () => <LoadingBlock label="Đang mở Biểu đồ…" /> });
const AgentTab = dynamic(() => import("./agent-tab").then((module) => module.AgentTab), { loading: () => <LoadingBlock label="Đang mở Agent…" /> });
const ReportTab = dynamic(() => import("./report-tab").then((module) => module.ReportTab), { loading: () => <LoadingBlock label="Đang mở Report Draft…" /> });

import { useState } from 'react';
import type { AnalysisExecution } from '@/lib/analysis-types';

type Props = { overview: ReactNode };

function confidenceLabel(scanMode?: string | null, approximate?: boolean) {
  if (approximate || scanMode === "sample") return "Preview · sample";
  return "Exact · full source";
}

export function CommandCenterShell({ overview }: Props) {
  const { runId } = useParams<{ runId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = isCommandCenterTab(searchParams.get("tab")) ? searchParams.get("tab") : "overview";
  const activeTab = tab as CommandCenterTab;
  const tabListId = useId();
  const tabRefs = useRef<Partial<Record<CommandCenterTab, HTMLButtonElement>>>({});
  const [selectedExecution, setSelectedExecution] = useState<AnalysisExecution | null>(null);
  const profile = useQuery({
    queryKey: ["profile", runId], queryFn: ({ signal }) => getProfile(runId, signal), enabled: Boolean(runId),
    refetchInterval: (query) => ["created", "queued", "running", "resuming"].includes(query.state.data?.status || "") ? 3_000 : false,
  });

  function selectTab(next: CommandCenterTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    requestAnimationFrame(() => tabRefs.current[next]?.focus());
  }

  function moveTab(current: CommandCenterTab, direction: -1 | 1) {
    const index = COMMAND_CENTER_TABS.indexOf(current);
    const next = COMMAND_CENTER_TABS[(index + direction + COMMAND_CENTER_TABS.length) % COMMAND_CENTER_TABS.length];
    selectTab(next);
  }

  function explainExecution(execution: AnalysisExecution) {
    setSelectedExecution(execution);
    selectTab('agent');
  }

  if (profile.isLoading) return <LoadingBlock label="Đang tải Command Center…" />;
  if (profile.isError) return <ErrorNotice error={profile.error} retry={() => profile.refetch()} />;
  if (!profile.data) return <Notice tone="warning">Profile không tồn tại hoặc bạn không còn quyền truy cập.</Notice>;
  const data = profile.data;

  return <main className="page command-center" aria-labelledby="command-center-title">
    <div style={{ marginBottom: "1rem" }}>
      <Link href="/datasets" className="button secondary">← Quay lại Datasets</Link>
    </div>
    <header className="command-center-header">
      <div>
        <p className="eyebrow">PROFILE RUN COMMAND CENTER</p>
        <h1 id="command-center-title">{data.dataset_name || "Dataset"}</h1>
        <p className="muted">{data.run_name || "Profile run"} · v{data.version ?? "-"}</p>
      </div>
      <div className="command-center-status" aria-label="Thông tin profile run">
        <span className="chip">{data.scan_mode || "unknown"} scan</span>
        <StatusBadge status={data.status} />
        <span className={data.is_approximate ? "chip warning" : "chip"}>{confidenceLabel(data.scan_mode, data.is_approximate)}</span>
        {data.pending_proposals > 0 && <span className="chip pii">{data.pending_proposals} đề xuất cần review</span>}
      </div>
    </header>

    {data.status === "failed" && <Notice tone="warning"><b>Profile chạy thất bại.</b><p>{data.error || "Hãy kiểm tra source và bắt đầu một profile run mới."}</p><Link className="button secondary" href={`/datasets/${data.dataset_id}/runs`}>Mở profile runs</Link></Notice>}
    {data.status === "pending_review" && <Notice tone="warning"><b>Cần review đê xuất trước khi chạy Explorer.</b><p>Xử lý đề xuất đang chờ để giữ evidence và PII policy chính xác.</p><Link className="button primary" href={`/profiles/${runId}/review?returnTo=${encodeURIComponent(`/profiles/${runId}?tab=${activeTab}`)}`}>Review đề xuất</Link></Notice>}

    <div className="command-center-tabs" role="tablist" aria-label="Command Center tabs" id={tabListId}>
      {COMMAND_CENTER_TABS.map((item) => <button
        key={item} ref={(node) => { tabRefs.current[item] = node ?? undefined; }} type="button" role="tab"
        id={`command-center-tab-${item}`} aria-selected={activeTab === item} aria-controls={`command-center-panel-${item}`}
        className={activeTab === item ? "command-center-tab active" : "command-center-tab"} onClick={() => selectTab(item)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') moveTab(item, 1);
          if (event.key === 'ArrowLeft') moveTab(item, -1);
          if (event.key === 'Home') selectTab(COMMAND_CENTER_TABS[0]);
          if (event.key === 'End') selectTab(COMMAND_CENTER_TABS[COMMAND_CENTER_TABS.length - 1]);
        }}
      >{COMMAND_CENTER_TAB_LABELS[item]}</button>)}
    </div>

    <section id={`command-center-panel-${activeTab}`} role="tabpanel" aria-labelledby={`command-center-tab-${activeTab}`} tabIndex={0} className="command-center-panel">
      {activeTab === "overview" && overview}
      {activeTab === "charts" && <ChartsTab runId={runId} profile={data} onExplain={explainExecution} />}
      {activeTab === 'explorer' && <ExplorerTab runId={runId} profile={data} onExplain={explainExecution} />}
      {activeTab === 'agent' && <AgentTab runId={runId} execution={selectedExecution} />}
      {activeTab === "report" && <ReportTab runId={runId} />}
    </section>
  </main>;
}

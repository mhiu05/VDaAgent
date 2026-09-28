import type { MessageContextRef } from '@vda/contracts';
import { workflowStatusLabel } from '../../../lib/format/status-label';
import type { useAgentChatController } from '../../agent-chat/hooks/use-agent-chat-controller';
import styles from './grok-workspace.module.css';

type Controller = ReturnType<typeof useAgentChatController>;

export function threadReportOptions(chat: Controller) {
  const threadRuns = new Set(chat.messages.map((message) => message.run_id).filter(Boolean));
  for (const message of chat.messages) for (const part of message.parts) if ('run_id' in part) threadRuns.add(part.run_id);
  const ids = new Set(chat.messages.flatMap((message) => message.parts.flatMap((part) => part.type === 'report_ref' ? [part.report_id] : [])));
  if (chat.threadWorkspace.context.active_report_id) ids.add(chat.threadWorkspace.context.active_report_id);
  return chat.threadWorkspace.reports.filter((report) => report.conversation_id === chat.selectedConversationId || ids.has(report.report_id) || threadRuns.has(report.run_id));
}

export function ThreadContextControls({ chat }: { chat: Controller }) {
  const { context, saving, update } = chat.threadWorkspace;
  const datasets = chat.threadWorkspace.datasets ?? [];
  const reports = threadReportOptions(chat);
  const runs = [...new Set([chat.visibleRunId, ...chat.messages.flatMap((message) => [message.run_id, ...message.parts.flatMap((part) => 'run_id' in part ? [part.run_id] : [])])].filter((id): id is string => Boolean(id)))];
  return <div className={styles.contextControls}>
    <label>Tập dữ liệu
      <select aria-label="Tập dữ liệu đang chọn" value={context.dataset_ids?.[0] ?? ''} disabled={chat.busy || saving || !chat.canWrite} onChange={(event) => void update({ dataset_ids: event.target.value ? [event.target.value] : [] })}>
        <option value="">Ảnh chụp dữ liệu dự án</option>
        {datasets.map((dataset) => <option key={dataset.import_id} value={dataset.import_id}>{dataset.source_name} · {dataset.row_count} dòng</option>)}
      </select>
    </label>
    <label>Phạm vi<select aria-label="Dự án phân tích" value={chat.project} disabled={chat.busy || !chat.canWrite} onChange={(event) => chat.updateProject(event.target.value)}>
      {!chat.project && <option value="">Chọn dự án</option>}
      {chat.catalog.projects.map((project) => <option key={project.project_external_id} value={project.project_external_id}>{project.project_external_id}</option>)}
    </select></label>
    <label>Ngày dữ liệu<input aria-label="Ngày chụp dữ liệu" type="date" value={chat.dataAsOf} disabled={chat.busy || !chat.canWrite} onChange={(event) => chat.updateDataAsOf(event.target.value)} /></label>
    <label>Báo cáo
      <select aria-label="Báo cáo đang chọn" disabled={saving || !chat.canWrite} value={chat.reportIntent === 'new' ? '__new' : context.active_report_id ?? ''} onChange={(event) => {
        const id = event.target.value;
        chat.setReportIntent(id === '__new' ? 'new' : null);
        if (id !== '__new') void update({ active_report_id: id || null, active_artifact_id: reports.find((report) => report.report_id === id)?.artifact_id ?? null, referenced_artifact_ids: [] });
      }}>
        <option value="">Chưa chọn báo cáo</option>
        {reports.map((report) => <option key={report.report_id} value={report.report_id}>Report {report.report_id.slice(0, 8)} · v{report.version ?? 1}</option>)}
        <option value="__new">+ Báo cáo mới</option>
      </select>
    </label>
    <label>Lượt chạy
      <select aria-label="Lượt chạy đang chọn" value={chat.visibleRunId ?? ''} onChange={(event) => { if (event.target.value) chat.selectRun(event.target.value); }}>
        {!chat.visibleRunId && <option value="">Chưa chọn lượt chạy</option>}
        {runs.map((id) => <option key={id} value={id}>{id.slice(0, 8)}{id === chat.visibleRunId && chat.currentRunDetail ? ` · ${workflowStatusLabel(chat.currentRunDetail.run.status)}` : ''}</option>)}
      </select>
    </label>
  </div>;
}

export function MessageContextControls({ chat }: { chat: Controller }) {
  const refs = chat.messageContextRefs;
  const reports = threadReportOptions(chat);
  const choices: Array<{ ref: MessageContextRef; label: string }> = [
    ...(chat.threadWorkspace.datasets ?? []).map((dataset) => ({ ref: { type: 'dataset' as const, id: dataset.import_id }, label: `${dataset.source_name} · ${dataset.row_count} dòng` })),
    ...reports.map((report) => ({ ref: { type: 'report' as const, id: report.report_id }, label: `Báo cáo ${report.report_id.slice(0, 8)} · v${report.version ?? 1}` })),
    ...chat.bundle.artifacts.filter((artifact) => artifact.kind !== 'report_draft' && artifact.kind !== 'review_result').map((artifact) => ({ ref: { type: 'artifact' as const, id: artifact.artifact_id }, label: `${artifact.kind.replaceAll('_', ' ')} · ${artifact.artifact_id.slice(0, 8)}` })),
  ];
  return <div className={styles.messageContext} aria-label="Ngữ cảnh tin nhắn">
    {chat.replyToMessageId && <button type="button" onClick={() => chat.setReplyToMessageId(null)} aria-label="Xóa ngữ cảnh trả lời" title={chat.messages.find((message) => message.message_id === chat.replyToMessageId)?.content}>Trả lời {chat.messages.find((message) => message.message_id === chat.replyToMessageId)?.sender_agent ?? 'tin nhắn'} · {chat.replyToMessageId.slice(0, 8)} ×</button>}
    <label><span>+ Đính kèm ngữ cảnh</span><select aria-label="Đính kèm báo cáo hoặc bằng chứng" value="" disabled={!chat.canWrite || chat.busy || refs.length >= 24} onChange={(event) => {
      const choice = choices.find(({ ref }) => `${ref.type}:${ref.id}` === event.target.value);
      if (choice && !refs.some((ref) => ref.type === choice.ref.type && ref.id === choice.ref.id)) chat.setMessageContextRefs([...refs, choice.ref]);
    }}><option value="">Chọn báo cáo / bằng chứng</option>{choices.map(({ ref, label }) => <option key={`${ref.type}:${ref.id}`} value={`${ref.type}:${ref.id}`}>{label}</option>)}</select></label>
    {refs.map((ref) => <button type="button" key={`${ref.type}:${ref.id}`} onClick={() => chat.setMessageContextRefs(refs.filter((item) => item !== ref))} aria-label={`Bỏ ${ref.type} ${ref.id} khỏi tin nhắn`}>{choices.find((item) => item.ref.type === ref.type && item.ref.id === ref.id)?.label ?? `${ref.type} · ${ref.id.slice(0, 8)}`} ×</button>)}
    {chat.reportIntent === 'new' && <button type="button" onClick={() => chat.setReportIntent(null)}>Báo cáo mới ×</button>}
  </div>;
}

'use client';

import { createElement, type ChangeEvent } from 'react';
import { Send, ShieldCheck, Sparkles } from 'lucide-react';
import type { AgentKey, Catalog } from '@vda/contracts';
import { ScopeFields } from '../resource-panels';

const suggestions = [
  'Show current available inventory.',
  'Which units are slow moving?',
  'Compare available inventory with 30 days ago.',
  'Show current price distribution.',
  'Generate an inventory report.',
];

const agentTargets: Array<{ value: AgentKey | null; label: string }> = [
  { value: null, label: 'Tự động' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'comparison', label: 'Comparison' },
  { value: 'chart', label: 'Chart' },
  { value: 'report', label: 'Report' },
];

export function Composer({
  catalog,
  canWrite,
  project,
  zone,
  dataAsOf,
  draft,
  busy,
  agentTarget,
  scheduledReadOnly,
  onProject,
  onZone,
  onDate,
  onDraft,
  onAgentTarget,
  onSubmit,
}: {
  catalog: Catalog;
  canWrite: boolean;
  project: string;
  zone: string;
  dataAsOf: string;
  draft: string;
  busy: boolean;
  agentTarget: AgentKey | null;
  scheduledReadOnly: boolean;
  onProject: (value: string) => void;
  onZone: (value: string) => void;
  onDate: (value: string) => void;
  onDraft: (value: string) => void;
  onAgentTarget: (value: AgentKey | null) => void;
  onSubmit: () => void;
}) {
  const disabled = !canWrite || busy || scheduledReadOnly;
  const ready = !disabled && !!project && !!dataAsOf && !!draft.trim();
  return (
    <section className="agent-composer card">
      <header className="section-heading">
        <div className="composer-title">
          <span className="spark-icon">
            <Sparkles size={20} />
          </span>
          <div>
            <h2>Hỏi dữ liệu của bạn</h2>
            <p>Agent chỉ khởi tạo các phân tích tồn kho có bằng chứng.</p>
          </div>
        </div>
        <span className="badge">Project / Zone</span>
      </header>
      <div className="scope-row">
        <ScopeFields
          catalog={catalog}
          project={project}
          zone={zone}
          setProject={onProject}
          setZone={onZone}
          disabled={disabled}
        />
        <label>
          Ngày dữ liệu
          <input
            type="date"
            required
            value={dataAsOf}
            onChange={(event) => onDate(event.target.value)}
            disabled={disabled}
          />
        </label>
        <label>
          Agent target
          {createElement(
            'select',
            {
              'aria-label': 'Agent target',
              value: agentTarget ?? '',
              disabled,
              onChange: (event: ChangeEvent<HTMLSelectElement>) =>
                onAgentTarget((event.target.value as AgentKey) || null),
            },
            agentTargets.map((target) =>
              createElement(
                'option',
                { key: target.value ?? 'auto', value: target.value ?? '' },
                target.label,
              ),
            ),
          )}
        </label>
      </div>
      <label className="question-label">
        <span className="sr-only">Câu hỏi phân tích</span>
        <textarea
          aria-label="Câu hỏi phân tích"
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && ready) {
              event.preventDefault();
              onSubmit();
            }
          }}
          maxLength={2000}
          rows={3}
          placeholder="Ví dụ: Phân khu nào có sản phẩm chậm luân chuyển?"
          disabled={disabled}
        />
      </label>
      <div className="composer-footer">
        <span>
          <span className="live-dot" />
          {catalog.latest_snapshot_date
            ? `Snapshot mới nhất: ${catalog.latest_snapshot_date}`
            : 'Chưa có snapshot'}
        </span>
        <button className="primary" type="button" disabled={!ready} onClick={onSubmit}>
          <Send size={16} /> {busy ? 'Đang gửi…' : 'Gửi yêu cầu'}
        </button>
      </div>
      {!canWrite && (
        <p className="viewer-notice">
          <ShieldCheck size={15} /> Viewer có thể xem hội thoại và kết quả, nhưng không thể gửi hoặc
          hủy phân tích.
        </p>
      )}
      {canWrite && !busy && !scheduledReadOnly && (
        <div className="agent-suggestions" aria-label="Gợi ý câu hỏi được hỗ trợ">
          {suggestions.map((suggestion) => (
            <button key={suggestion} className="suggestion" onClick={() => onDraft(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

'use client';

import { createElement, useEffect, useRef, type ChangeEvent } from 'react';
import { Send, ShieldCheck, Sparkles } from 'lucide-react';
import type { AgentKey, CapabilityMode, Catalog } from '@vda/contracts';
import { ScopeFields } from '../../components/forms/scope-fields';

const suggestions = [
  'Tổng lượng sản phẩm đang mở bán hiện tại là bao nhiêu?',
  'Sản phẩm nào đang luân chuyển chậm?',
  'So sánh tồn kho hiện tại với 30 ngày trước.',
  'Cho xem phân bố giá hiện tại.',
  'Tạo báo cáo tồn kho.',
];

const agentTargets: Array<{ value: AgentKey | null; label: string }> = [
  { value: null, label: 'Tự động' },
  { value: 'analyst', label: 'Phân tích' },
  { value: 'comparison', label: 'So sánh' },
  { value: 'chart', label: 'Biểu đồ' },
  { value: 'report', label: 'Báo cáo' },
];
const modePlaceholders: Record<CapabilityMode, string> = {
  grok: 'Hỏi về dữ liệu tồn kho trong phạm vi workspace.',
  data: 'Hỏi về dữ liệu đã xác thực và tình trạng mở bán.',
  insight: 'Yêu cầu nhận định có bằng chứng hỗ trợ.',
  compare: 'Yêu cầu so sánh các kết quả được phép xem.',
  chart: 'Hỏi về biểu đồ đã xác thực.',
  report: 'Hỏi về nội dung báo cáo hiện tại.',
};

export function Composer({
  catalog,
  canWrite,
  project,
  zone,
  dataAsOf,
  capabilityMode,
  focusRequest,
  compact = false,
  showAgentTarget = true,
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
  capabilityMode?: CapabilityMode;
  focusRequest?: number;
  compact?: boolean;
  showAgentTarget?: boolean;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const disabled = !canWrite || busy || scheduledReadOnly;
  const ready = !disabled && !!project && !!dataAsOf && !!draft.trim();
  useEffect(() => {
    if (focusRequest) textareaRef.current?.focus();
  }, [focusRequest]);
  return (
    <section className={`agent-composer card ${compact ? 'agent-composer-compact' : ''}`}>
      {!compact && <>
      <header className="section-heading">
        <div className="composer-title">
          <span className="spark-icon">
            <Sparkles size={20} />
          </span>
          <div>
            <h2>Hỏi dữ liệu của bạn</h2>
            <p>Trợ lý chỉ khởi tạo các phân tích tồn kho có bằng chứng.</p>
          </div>
        </div>
        <span className="badge">
          {capabilityMode ? 'Chế độ: ' + capabilityMode : 'Dự án / phân khu'}
        </span>
      </header>
      </>}
      {compact && <details className="agent-composer-scope">
        <summary>Phạm vi cho yêu cầu tiếp theo: {project || 'Chọn dự án'}{zone ? ` / ${zone}` : ''} · {dataAsOf || 'Chọn ngày'}</summary>
      </details>}
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
        {showAgentTarget && (
          <label>
            Tác nhân xử lý
            {createElement(
              'select',
              {
                'aria-label': 'Tác nhân xử lý',
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
        )}
      </div>
      <label className="question-label">
        <span className="sr-only">Câu hỏi phân tích</span>
        <textarea
          ref={textareaRef}
          aria-label="Câu hỏi phân tích"
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && ready && !composingRef.current && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSubmit();
            }
          }}
          maxLength={2000}
          rows={compact ? 2 : 3}
          placeholder={
            capabilityMode
              ? modePlaceholders[capabilityMode]
              : 'Ví dụ: Phân khu nào có sản phẩm chậm luân chuyển?'
          }
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
          <ShieldCheck size={15} /> Người xem có thể xem hội thoại và kết quả, nhưng không thể gửi hoặc
          hủy phân tích.
        </p>
      )}
      {canWrite && !busy && !scheduledReadOnly && (
        <>
        {compact && <details className="agent-composer-quick-actions"><summary>Gợi ý câu hỏi</summary></details>}
        <div className="agent-suggestions" aria-label="Gợi ý câu hỏi được hỗ trợ">
          {suggestions.map((suggestion) => (
            <button key={suggestion} className="suggestion" onClick={() => onDraft(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
        </>
      )}
    </section>
  );
}

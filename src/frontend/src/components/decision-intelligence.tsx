import { ArrowUpRight } from 'lucide-react';
import type { DecisionIntelligencePack, MetricUnit } from '@vda/contracts';
import { formatChartValue } from '../lib/chart-format';
import { workflowStatusLabel } from '../lib/format/status-label';

const formats: Record<MetricUnit, 'integer' | 'percent' | 'percentage_points' | 'days' | 'currency' | 'currency_per_area'> = {
  count: 'integer',
  percent: 'percent',
  percentage_points: 'percentage_points',
  days: 'days',
  currency: 'currency',
  currency_per_sqm: 'currency_per_area',
};

function displayValue(value: string | number | null, unit: MetricUnit, currency: string | null) {
  const parsed = value === null ? null : Number(value);
  return formatChartValue(Number.isFinite(parsed) ? parsed : null, formats[unit], currency);
}

export function DecisionIntelligenceView({
  pack,
  onEvidence,
  onLoadDetails,
}: {
  pack: DecisionIntelligencePack;
  onEvidence: (artifactId: string) => void;
  onLoadDetails?: () => void;
}) {
  const brief = pack.decision_brief;
  const openDrilldown = (drilldownId: string) => {
    const drilldown = pack.drilldowns.find((candidate) => candidate.drilldown_id === drilldownId);
    if (!drilldown) return;
    if (drilldown.kind === 'open_evidence') {
      onEvidence(drilldown.evidence_refs[0]!.artifact_id);
      return;
    }
    if (drilldown.kind === 'open_chart') {
      onEvidence(drilldown.chart_pack_artifact_id);
      return;
    }
    onLoadDetails?.();
  };
  return (
    <section className='card decision-brief'>
      <header className='section-heading'>
        <div>
          <span className='eyebrow'>HỖ TRỢ QUYẾT ĐỊNH · {pack.contract_version}</span>
          <h2>{brief.headline}</h2>
        </div>
        <span className='badge'>{workflowStatusLabel(brief.status)}</span>
      </header>
      <dl className='brief-scope'>
        <div><dt>Phạm vi</dt><dd>{brief.scope.project_external_id} / {brief.scope.zone_external_id ?? 'Toàn dự án'}</dd></div>
        <div><dt>Ngày dữ liệu yêu cầu</dt><dd>{brief.requested_data_as_of}</dd></div>
        <div><dt>Mức hoàn thiện</dt><dd>{workflowStatusLabel(pack.handoff.completeness)}</dd></div>
      </dl>
      <section className='brief-section'>
        <h3>Chỉ số hiện tại</h3>
        <div className='chart-kpi-grid'>
          {brief.kpi_cards.map((card) => (
            <button className='brief-signal' key={card.kpi_id} onClick={() => onEvidence(card.metric_ref.artifact_id)}>
              <span><strong>{card.label}</strong><small>{displayValue(card.value, card.unit, card.currency)}</small></span>
            </button>
          ))}
        </div>
      </section>
      <div className='brief-flow'>
        <section className='brief-section'>
          <h3>Biến động đáng chú ý</h3>
          <div className='brief-signal-list'>
            {brief.material_changes.map((change) => (
              <button className='brief-signal' key={change.change_id} onClick={() => onEvidence(change.evidence_refs[0]!.artifact_id)}>
                <span><strong>{change.metric_key} · {workflowStatusLabel(change.severity)}</strong><small>{workflowStatusLabel(change.direction)} trong {change.period_days} ngày</small></span>
              </button>
            ))}
            {!brief.material_changes.length && <p className='muted'>Không có thay đổi ảnh hưởng đến quyết định.</p>}
          </div>
        </section>
        <section className='brief-section'>
          <h3>Xem xét trước</h3>
          <div className='brief-signal-list'>
            {pack.priority_entities.map((entity) => (
              <button
                className='brief-signal'
                key={entity.priority_entity_id}
                onClick={() => openDrilldown(entity.drilldown_ids[0]!)}
              >
                <span><strong>#{entity.rank} {entity.entity.label}</strong><small>{entity.tier} - {entity.reason_codes.join(', ')}</small></span>
              </button>
            ))}
          </div>
        </section>
        <section className='brief-section'>
          <h3>Giới hạn dữ liệu</h3>
          <div className='brief-signal-list'>
            {brief.watchouts.map((watchout) => (
              <div className='brief-signal' key={watchout.watchout_id}>
                <span><strong>{watchout.label}</strong><small>{watchout.reason}</small></span>
              </div>
            ))}
            {!brief.watchouts.length && <p className='muted'>Không có giới hạn quyết định bổ sung.</p>}
          </div>
        </section>
      </div>
      <section className='brief-section'>
        <h3>{pack.visual_story.headline}</h3>
        <div className='button-row'>
          {pack.visual_story.ordered_visuals
            .filter((visual) => visual.role === 'primary')
            .map((visual) => (
              <button
                className='text-button'
                key={visual.chart_id}
                onClick={onLoadDetails}
              >
                {visual.reason} <ArrowUpRight size={14} />
              </button>
            ))}
          {!pack.visual_story.primary_visual_ids.length && (
            <p className='muted'>Chưa có hình ảnh dữ liệu chính phù hợp.</p>
          )}
        </div>
      </section>
      <section className='brief-actions'>
        <h3>Bước tiếp theo có căn cứ</h3>
        <div className='button-row'>
          {pack.action_candidates.map((action) => (
            <button
              className='secondary'
              key={action.action_candidate_id}
              onClick={() => openDrilldown(action.drilldown_id)}
            >
              {action.label} <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}

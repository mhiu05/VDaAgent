import type { DecisionBriefResponse, DecisionIntelligenceResponse } from '@vda/contracts';

export function DecisionResultSummary({ runId, decision, brief, onEvidence }: {
  runId: string;
  decision: DecisionIntelligenceResponse | null;
  brief: DecisionBriefResponse | null;
  onEvidence: (artifactId: string, path: string | null) => void;
}) {
  if (decision?.run_id !== runId && brief?.run_id !== runId) return null;
  if (decision?.status === 'available') {
    const pack = decision.decision_intelligence;
    const evidence = pack.decision_brief.evidence_refs[0];
    return <section aria-label="Kết quả quyết định đã phát hành" data-stage-output="publication">
      <h2>Kết quả quyết định</h2>
      <p>{pack.decision_brief.headline}</p>
      {pack.decision_brief.watchouts.slice(0, 3).map((item) => <p key={item.watchout_id}><strong>{item.label}:</strong> {item.reason}</p>)}
      {evidence && <button type="button" onClick={() => onEvidence(evidence.artifact_id, evidence.path)}>Xem bằng chứng quyết định</button>}
    </section>;
  }
  const legacy = decision?.status === 'legacy_report_brief' ? decision.decision_brief : brief?.run_id === runId ? brief.decision_brief : null;
  if (!legacy) return null;
  return <section aria-label="Tóm tắt quyết định đã phát hành" data-stage-output="report">
    <h2>Tóm tắt quyết định</h2>
    {legacy.current_state.slice(0, 3).map((signal) => <p key={signal.signal_id}>{signal.summary}</p>)}
  </section>;
}

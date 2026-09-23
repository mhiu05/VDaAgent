import type { AgentActivityEventV1 } from '@vda/contracts';

const labels: Record<AgentActivityEventV1['label'], string> = {
  understanding_context: 'Understanding the authorized context',
  inspecting_context: 'Inspecting authorized context',
  starting_analysis: 'Starting analysis',
  analysis_queued: 'Analysis queued',
  analysis_progress: 'Analysis progress is available in the run view',
  preparing_answer: 'Preparing a grounded answer',
  answer_ready: 'Grounded answer ready',
  safe_error: 'The assistant completed with a safe status',
};

export function ActivityTimeline({ events }: { events: AgentActivityEventV1[] }) {
  if (!events.length) return null;
  return (
    <section
      className="notice agent-activity-timeline"
      aria-label="Assistant activity"
      aria-live="polite"
    >
      <strong>Assistant activity</strong>
      {events.map((event) => (
        <div className="agent-pending" key={event.sequence}>
          <span className="agent-status-dot in_progress" aria-hidden="true" />
          {labels[event.label]}
        </div>
      ))}
    </section>
  );
}

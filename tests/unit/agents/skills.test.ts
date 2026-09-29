import { describe, expect, it } from 'vitest';
import type { Artifact, ArtifactOf } from '@vda/contracts';
import {
  checkSkillCoverage,
  getSkill,
  listSkills,
  selectSkill,
} from '../../../src/backend/agents/skills';

describe('server-owned skill registry', () => {
  it('selects the same slow-inventory skill for interactive and scheduled execution', () => {
    const interactive = selectSkill('slow_moving_inventory', 'interactive_analysis');
    const scheduled = selectSkill('slow_moving_inventory', 'scheduled_report');
    expect(interactive).toEqual(scheduled);
    expect(listSkills()).toHaveLength(1);
    expect(getSkill('slow-inventory-analysis')).toEqual(interactive);
    expect(() => getSkill('unknown-skill')).toThrow('UNKNOWN_SKILL');
  });

  it('detects missing persisted metrics and evidence without manufacturing values', () => {
    const skill = getSkill('slow-inventory-analysis');
    const draft = {
      kind: 'report_draft',
      run_id: 'run-1',
      payload: { evidence_refs: [] },
    } as unknown as ArtifactOf<'report_draft'>;
    const artifacts = [
      draft,
      {
        kind: 'data_analysis_pack',
        run_id: 'run-1',
        payload: { metrics: [{ key: 'available_inventory', value: null }] },
      },
    ] as Artifact[];
    const coverage = checkSkillCoverage(skill, artifacts, draft);
    expect(coverage.missing_metrics).toContain('slow_moving_rate');
    expect(coverage.missing_artifacts).toContain('insight_pack');
    expect(coverage.missing_report_evidence).toBe(true);
  });
});

import {
  DEFAULT_USE_CASE,
  SkillDefinitionSchema,
  type Artifact,
  type ArtifactOf,
  type SkillDefinition,
  type UseCaseKey,
} from '@vda/contracts';

const slowInventory = SkillDefinitionSchema.parse({
  id: 'slow-inventory-analysis',
  version: '1',
  name: 'Slow inventory analysis',
  description:
    'Analyze ageing, availability, sales velocity and price using pinned inventory evidence.',
  use_case: 'slow_moving_inventory',
  supported_intents: ['interactive_analysis', 'scheduled_report'],
  required_metrics: [
    'available_inventory',
    'slow_moving_units',
    'slow_moving_rate',
    'median_inventory_age_days',
    'median_price',
  ],
  required_artifacts: [
    'data_analysis_pack',
    'comparison_pack',
    'analysis_pack',
    'insight_pack',
    'report_draft',
    'review_result',
  ],
  evidence_policy: { require_report_refs: true },
  report_policy: { require_review_pass: true },
});

const skills: readonly SkillDefinition[] = Object.freeze([slowInventory]);
const byId = new Map(skills.map((skill) => [skill.id, skill]));
const byUseCase = new Map(skills.map((skill) => [skill.use_case, skill]));

export class UnknownSkillError extends Error {
  readonly code = 'UNKNOWN_SKILL';
  constructor(id: string) {
    super(`UNKNOWN_SKILL:${id}`);
  }
}

export function listSkills(): readonly SkillDefinition[] {
  return skills;
}

export function getSkill(id: string): SkillDefinition {
  const skill = byId.get(id);
  if (!skill) throw new UnknownSkillError(id);
  return skill;
}

export function selectSkill(
  useCase: UseCaseKey | null | undefined,
  intent: SkillDefinition['supported_intents'][number],
): SkillDefinition {
  const skill = byUseCase.get(useCase ?? DEFAULT_USE_CASE);
  if (!skill || !skill.supported_intents.includes(intent))
    throw new UnknownSkillError(useCase ?? DEFAULT_USE_CASE);
  return skill;
}

export type SkillCoverage = {
  missing_artifacts: Artifact['kind'][];
  missing_metrics: SkillDefinition['required_metrics'];
  missing_report_evidence: boolean;
};

/** Checks business requirements on persisted artifacts; unavailable metric values remain honest. */
export function checkSkillCoverage(
  skill: SkillDefinition,
  artifacts: readonly Artifact[],
  draft: ArtifactOf<'report_draft'>,
): SkillCoverage {
  const kinds = new Set(artifacts.map((artifact) => artifact.kind));
  const data = artifacts.find(
    (artifact): artifact is ArtifactOf<'data_analysis_pack'> =>
      artifact.kind === 'data_analysis_pack' && artifact.run_id === draft.run_id,
  );
  const metrics = new Set(data?.payload.metrics.map((metric) => metric.key) ?? []);
  return {
    missing_artifacts: skill.required_artifacts.filter(
      (kind) => kind !== 'review_result' && !kinds.has(kind),
    ),
    missing_metrics: skill.required_metrics.filter((key) => !metrics.has(key)),
    missing_report_evidence:
      skill.evidence_policy.require_report_refs && draft.payload.evidence_refs.length === 0,
  };
}

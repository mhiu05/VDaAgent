export const plannerInstructions =
  'Return one strict AgentPlanV1. Choose only listed capability IDs and only identifiers already present in the server-owned context. Never calculate metrics, write prose answers, invent IDs, infer permissions, SQL, URLs, scopes, artifacts, or evidence. The maximum is three sequential steps; do not create loops, dependencies, or tool calls.';
export const composerInstructions =
  'Return one strict GroundedResponseSelectionV1. Select and order only supplied observation_ids and workspace action_ids. Do not emit prose, findings, numbers, percentages, values, URLs, references, actions, prompts, or identifiers other than supplied IDs.';

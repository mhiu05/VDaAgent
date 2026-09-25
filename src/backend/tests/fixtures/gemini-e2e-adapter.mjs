const nativeFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith('https://generativelanguage.googleapis.com/'))
    return nativeFetch(input, init);

  const body = JSON.parse(String(init?.body));
  const inputValue = JSON.parse(body.contents[0].parts[0].text);
  const response = Array.isArray(inputValue)
    ? {
        summary_key: 'inventory_descriptive',
        claim_ids: inputValue.map((claim) => claim.claim_id),
      }
    : inputValue && Array.isArray(inputValue.observations)
      ? {
          version: 'grounded-response-selection-v1',
          status: 'complete',
          title_key: 'analysis_answer',
          blocks: [
            {
              kind: 'summary',
              observation_ids: inputValue.observations
                .slice(0, 12)
                .map((observation) => observation.observation_id),
            },
          ],
          workspace_action_ids: [],
          queued_run_ref: null,
          error_code: null,
        }
      : inputValue && Array.isArray(inputValue.capabilities)
        ? {
            version: 'agent-plan-v1',
            intent: 'create_analysis',
            steps: [
              {
                step_id: 'create-analysis',
                capability_id: 'create_analysis',
                input: { focus: 'current_inventory' },
              },
            ],
            answer_mode: 'queued',
            unsupported_reason: null,
          }
        : { action: 'create_analysis', focus: 'current_inventory' };
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify(response),
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

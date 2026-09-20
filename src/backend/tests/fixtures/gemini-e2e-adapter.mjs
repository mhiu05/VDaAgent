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

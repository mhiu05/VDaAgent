export type TurnRequestIdentity = { client_turn_id: string; idempotency_key: string };

export function createTurnIdentity(): TurnRequestIdentity {
  const id = crypto.randomUUID();
  return { client_turn_id: id, idempotency_key: crypto.randomUUID() };
}

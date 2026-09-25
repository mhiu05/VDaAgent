import type { Message } from '@vda/contracts';

/** Keep the first persisted position while refreshing mutable message content. */
export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((message) => [message.message_id, message]));
  for (const message of incoming) {
    const prior = byId.get(message.message_id);
    const incomingTime = message.updated_at ?? message.created_at;
    const priorTime = prior?.updated_at ?? prior?.created_at;
    if (
      !prior ||
      incomingTime > priorTime! ||
      (incomingTime === priorTime &&
        prior.status === 'in_progress' &&
        message.status !== 'in_progress')
    )
      byId.set(message.message_id, message);
  }
  const known = new Set(current.map((message) => message.message_id));
  const earlier = incoming.filter((message) => !known.has(message.message_id));
  const first = current[0]?.created_at;
  const prepended = first ? earlier.filter((message) => message.created_at < first) : earlier;
  const appended = first ? earlier.filter((message) => message.created_at >= first) : [];
  return [...prepended, ...current.map((message) => byId.get(message.message_id)!), ...appended];
}

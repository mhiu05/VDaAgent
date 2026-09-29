import type { AgentActivityEventV1, AgentTurnRequest } from '@vda/contracts';
import { ApiError } from '../../../lib/http/api-client';
import type { TurnRequestIdentity } from '../../../lib/http/turn-identity';
import { sendTurnStream } from '../../../lib/sse';
import { sendTurn } from './conversations';

type TurnInput = Omit<AgentTurnRequest, 'org_id' | 'client_turn_id'>;

export async function deliverAgentTurn(
  orgId: string,
  input: TurnInput,
  identity: TurnRequestIdentity,
  conversationId: string | undefined,
  sseEnabled: boolean,
  onActivity: (event: AgentActivityEventV1) => void,
) {
  try {
    return sseEnabled
      ? await sendTurnStream(orgId, input, identity, onActivity, conversationId)
      : await sendTurn(orgId, input, identity, conversationId);
  } catch (cause) {
    if (!(sseEnabled && cause instanceof ApiError && [404, 406].includes(cause.status)))
      throw cause;
    return sendTurn(orgId, input, identity, conversationId);
  }
}

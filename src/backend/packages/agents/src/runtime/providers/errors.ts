import type { AgentPlanV1, GroundedResponseSelectionV1 } from '@vda/contracts';
import type { AgentRuntimeComposerValidator, AgentRuntimePlannerValidator } from './contracts';

export class AgentRuntimeProviderError extends Error {
  constructor(
    readonly code:
      'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'PROVIDER_OUTPUT_INVALID' | 'TURN_CANCELLED',
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export function attemptSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return { timeout, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
}

/**
 * The runtime passes a combined client-cancel/turn-deadline signal to each
 * provider. AbortSignal.timeout carries a DOM TimeoutError reason, which lets
 * adapters preserve the public timeout result instead of misclassifying a
 * deadline as a user cancellation.
 */
export function isTimeoutAbort(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return false;
  const reason = signal.reason as { name?: unknown } | undefined;
  return reason?.name === 'TimeoutError';
}

export function classifyProviderError(
  error: unknown,
  signal: AbortSignal | undefined,
  timeout: AbortSignal,
): AgentRuntimeProviderError {
  if (error instanceof AgentRuntimeProviderError) return error;
  if (timeout.aborted || isTimeoutAbort(signal))
    return new AgentRuntimeProviderError('PROVIDER_TIMEOUT', true);
  if (signal?.aborted) return new AgentRuntimeProviderError('TURN_CANCELLED', false);
  return new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', true);
}

export function providerHttpError(status: number): AgentRuntimeProviderError {
  if (status === 408 || status === 429 || status >= 500)
    return new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', true);
  return new AgentRuntimeProviderError('PROVIDER_UNAVAILABLE', false);
}

export async function validateComposerResponse(
  response: GroundedResponseSelectionV1,
  validate: AgentRuntimeComposerValidator | undefined,
) {
  if (!validate) return;
  try {
    await validate(response);
  } catch {
    // Treat semantic grounding rejection exactly like malformed structured
    // output so the ordered provider may make one safe fallback attempt.
    throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', true);
  }
}

export async function validatePlannerResponse(
  plan: AgentPlanV1,
  validate: AgentRuntimePlannerValidator | undefined,
) {
  if (!validate) return;
  try {
    await validate(plan);
  } catch {
    throw new AgentRuntimeProviderError('PROVIDER_OUTPUT_INVALID', true);
  }
}

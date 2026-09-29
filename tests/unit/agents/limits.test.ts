import { describe, expect, it } from 'vitest';
import { AGENT_RUNTIME_LIMITS, runtimeLimits } from '../../../src/backend/agents/runtime/limits';

describe('server owned agent limits', () => {
  it('bounds calls, context and deadlines independently of provider input', () => {
    const limits = runtimeLimits();
    expect(limits.max_new_analysis_runs).toBe(1);
    expect(limits.max_mutating_capability_calls).toBe(1);
    expect(limits.max_provider_projection_bytes).toBe(24 * 1024);
    expect(limits.turn_timeout_ms).toBe(AGENT_RUNTIME_LIMITS.max_turn_timeout_ms);
    expect(
      runtimeLimits({ AGENT_PROVIDER_TIMEOUT_MS: 4_000, AGENT_TURN_TIMEOUT_MS: 10_000 }),
    ).toMatchObject({ provider_attempt_timeout_ms: 4_000, turn_timeout_ms: 10_000 });
  });

  it('rejects invalid or conflicting timeouts', () => {
    expect(() => runtimeLimits({ AGENT_PROVIDER_TIMEOUT_MS: 999 })).toThrow(
      'AGENT_PROVIDER_TIMEOUT_MS_INVALID',
    );
    expect(() => runtimeLimits({ AGENT_TURN_TIMEOUT_MS: 45_001 })).toThrow(
      'AGENT_TURN_TIMEOUT_MS_INVALID',
    );
    expect(() => runtimeLimits({ AGENT_TURN_TIMEOUT_MS: 1_000.5 })).toThrow(
      'AGENT_TURN_TIMEOUT_MS_INVALID',
    );
    expect(() =>
      runtimeLimits({ AGENT_PROVIDER_TIMEOUT_MS: 12_000, AGENT_TURN_TIMEOUT_MS: 10_000 }),
    ).toThrow('AGENT_PROVIDER_TIMEOUT_EXCEEDS_TURN');
  });
});

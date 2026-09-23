import { describe, expect, it } from 'vitest';
import { AGENT_RUNTIME_LIMITS, runtimeLimits } from './runtime-limits';

describe('runtimeLimits', () => {
  it('uses the P0 defaults and accepts a smaller validated turn deadline', () => {
    expect(runtimeLimits()).toMatchObject({
      ...AGENT_RUNTIME_LIMITS,
      provider_attempt_timeout_ms: 12_000,
      turn_timeout_ms: 45_000,
    });

    expect(
      runtimeLimits({ AGENT_PROVIDER_TIMEOUT_MS: 4_000, AGENT_TURN_TIMEOUT_MS: 10_000 }),
    ).toMatchObject({
      provider_attempt_timeout_ms: 4_000,
      turn_timeout_ms: 10_000,
    });
  });

  it('rejects timeout overrides outside the server-owned bounds', () => {
    expect(() => runtimeLimits({ AGENT_PROVIDER_TIMEOUT_MS: 999 })).toThrow(
      'AGENT_PROVIDER_TIMEOUT_MS_INVALID',
    );
    expect(() => runtimeLimits({ AGENT_PROVIDER_TIMEOUT_MS: 45_001 })).toThrow(
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

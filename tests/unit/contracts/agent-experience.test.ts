import { describe, expect, it } from 'vitest';
import {
  AgentFeedPageSchema,
  ExecutionRefSchema,
  RunRuntimeSnapshotSchema,
} from '../../../src/contracts';
import {
  acceptedRecipient,
  canonicalStoredAgent,
  decodeScopedAgentCursor,
  encodeAgentCursor,
  parseAgentItemId,
} from '../../../src/backend/database/mapping/agent-experience';

const org = 'f1a3a5c1-5374-4ee8-b4a6-857b13071b2a';
const conversation = '4cbe66a9-714c-4ced-b01e-25dd8292a363';
const activity = 'a4019134-4c1a-4bd7-a763-7f6060808628';
const scope = { org, conversation, agent: 'data' as const };

describe('agent experience identity', () => {
  it('separates job and runtime execution references', () => {
    expect(
      ExecutionRefSchema.parse({ source: 'runtime', run_id: org, activity_id: activity }).source,
    ).toBe('runtime');
    expect(
      ExecutionRefSchema.parse({ source: 'job', job_id: org, invocation_id: activity }).source,
    ).toBe('job');
    expect(
      ExecutionRefSchema.safeParse({ source: 'runtime', job_id: org, invocation_id: activity })
        .success,
    ).toBe(false);
  });

  it('retains database timestamp precision and cursor scope', () => {
    const tuple = { timestamp: '2026-09-29T12:34:56.123456Z', rank: 1 as const, id: activity };
    const cursor = encodeAgentCursor(scope, 'older', tuple);
    expect(decodeScopedAgentCursor(cursor, scope)).toEqual({ ...tuple, direction: 'older' });
    expect(() => decodeScopedAgentCursor(cursor, { ...scope, agent: 'insight' })).toThrow();
    expect(() => decodeScopedAgentCursor(cursor, { ...scope, conversation: org })).toThrow();
    expect(() => parseAgentItemId(`activity:${activity}`)).not.toThrow();
    expect(() => parseAgentItemId('activity:other')).toThrow();
  });

  it('resolves accepted recipient separately from sender and rejects public aliases', () => {
    expect(
      acceptedRecipient({ agent_turn: { request: { agent_target: 'data' } } }, 'coordinator'),
    ).toEqual({ agent: 'data', placement: 'accepted_request' });
    expect(
      acceptedRecipient({ agent_turn: { request: { agent_target: null } } }, 'data').agent,
    ).toBe('coordinator');
    expect(acceptedRecipient({}, 'comparison').placement).toBe('sender');
    expect(canonicalStoredAgent('compare')).toBe('comparison');
    expect(AgentFeedPageSchema.safeParse({ agent_key: 'compare' }).success).toBe(false);
  });

  it('keeps the old runtime snapshot valid without a watermark', () => {
    expect(
      RunRuntimeSnapshotSchema.safeParse({ records: [], events: [], last_sequence: 0 }).success,
    ).toBe(true);
    expect(
      RunRuntimeSnapshotSchema.safeParse({
        records: [],
        events: [],
        last_sequence: 0,
        snapshot_sequence: 4,
      }).success,
    ).toBe(true);
  });
});

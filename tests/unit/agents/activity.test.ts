import { describe, expect, it } from 'vitest';
import { AgentActivityEmitter } from '../../../src/backend/agents/runtime/activity';

describe('public agent activity', () => {
  it('emits an ordered, bounded projection without provider internals', () => {
    const events: unknown[] = [];
    const emitter = new AgentActivityEmitter((event) => events.push(event));
    emitter.emit('context_started', 'understanding_context');
    emitter.emit('tool_started', 'inspecting_context', { capability: 'inspect_visual' });
    emitter.emit('answer_completed', 'answer_ready');
    expect(events).toEqual([
      expect.objectContaining({ sequence: 0, type: 'context_started' }),
      expect.objectContaining({ sequence: 1, type: 'tool_started', capability: 'inspect_visual' }),
      expect.objectContaining({ sequence: 2, type: 'answer_completed' }),
    ]);
    expect(JSON.stringify(events)).not.toMatch(/prompt|observation|provider_request/);
  });
});

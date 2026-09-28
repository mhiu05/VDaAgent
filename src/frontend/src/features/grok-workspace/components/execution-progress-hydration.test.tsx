// @vitest-environment happy-dom

import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionProgress } from './execution-progress';

describe('execution orb hydration', () => {
  it('hydrates server markup for an active execution without a mismatch', async () => {
    const props = { run: null, job: null, accepted: true, records: [], onDetails: () => undefined };
    const container = document.createElement('div');
    container.innerHTML = renderToString(<ExecutionProgress {...props} />);
    document.body.append(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, <ExecutionProgress {...props} />); });
      expect(container.querySelector('canvas')).not.toBeNull();
      expect(errors.mock.calls.flat().join(' ')).not.toMatch(/hydration|did not match/i);
    } finally {
      await act(async () => { root?.unmount(); });
      errors.mockRestore();
      container.remove();
    }
  });
});

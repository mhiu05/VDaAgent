import { describe, expect, it } from 'vitest';
import type { Artifact } from '@vda/contracts';
import { resolveEvidencePath } from '../../src/frontend/features/evidence/evidence-path';

const artifact = { payload: { metrics: [{ value: 0 }, { value: null }] } } as Artifact;

describe('evidence path lookup', () => {
  it('distinguishes measured zero, unknown and absent values', () => {
    expect(resolveEvidencePath(artifact, 'payload.metrics[0].value')).toEqual({
      available: true,
      value: 0,
    });
    expect(resolveEvidencePath(artifact, 'payload.metrics[1].value')).toEqual({
      available: true,
      value: null,
    });
    expect(resolveEvidencePath(artifact, 'payload.metrics[2].value')).toEqual({
      available: false,
      value: null,
    });
  });

  it('refuses executable or external paths', () => {
    expect(resolveEvidencePath(artifact, 'payload.metrics[0].constructor()').available).toBe(false);
    expect(resolveEvidencePath(artifact, 'https://example.test/data').available).toBe(false);
  });
});

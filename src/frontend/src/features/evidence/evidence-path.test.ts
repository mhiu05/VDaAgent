import { describe, expect, it } from 'vitest';
import type { Artifact } from '@vda/contracts';
import { resolveEvidencePath } from './evidence-path';

const artifact = { payload: { metrics: [{ value: 0 }, { value: null }] } } as Artifact;

describe('resolveEvidencePath', () => {
  it('keeps zero and null distinct', () => {
    expect(resolveEvidencePath(artifact, 'payload.metrics[0].value')).toEqual({ available: true, value: 0 });
    expect(resolveEvidencePath(artifact, 'payload.metrics[1].value')).toEqual({ available: true, value: null });
  });
  it('does not execute arbitrary paths or invent absent values', () => {
    expect(resolveEvidencePath(artifact, 'payload.metrics[2].value').available).toBe(false);
    expect(resolveEvidencePath(artifact, 'payload.metrics[0].constructor()').available).toBe(false);
    expect(resolveEvidencePath(artifact, 'https://example.test/data').available).toBe(false);
  });
});

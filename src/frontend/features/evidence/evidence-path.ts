import type { Artifact } from '@vda/contracts';

/** Resolves a small data path grammar; it never executes the path as code. */
export function resolveEvidencePath(artifact: Artifact, path: string): { available: boolean; value: unknown } {
  if (!/^payload(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[[0-9]+\])*$/.test(path))
    return { available: false, value: null };
  const segments = path.slice('payload'.length).match(/\.[a-zA-Z_][a-zA-Z0-9_]*|\[[0-9]+\]/g) ?? [];
  let value: unknown = artifact.payload;
  for (const segment of segments) {
    const key = segment[0] === '.' ? segment.slice(1) : Number(segment.slice(1, -1));
    if (Array.isArray(value) && typeof key === 'number') {
      if (key >= value.length) return { available: false, value: null };
      value = value[key];
    } else if (value && typeof value === 'object' && typeof key === 'string' && Object.prototype.hasOwnProperty.call(value, key)) {
      value = (value as Record<string, unknown>)[key];
    } else return { available: false, value: null };
  }
  return { available: true, value };
}

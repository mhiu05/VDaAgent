import { createHash } from 'node:crypto';
import { ArtifactSchema, type Artifact } from '@vda/contracts/artifacts/artifact';

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(',')}}`;
}
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function artifactHash(artifact: Omit<Artifact, 'content_hash'> | Artifact): string {
  const { content_hash: _hash, ...body } = artifact as Artifact;
  return contentHash(body);
}
export function stableId(value: string): string {
  const hex = contentHash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function verifyArtifact(artifact: Artifact): void {
  ArtifactSchema.parse(artifact);
  if (artifactHash(artifact) !== artifact.content_hash) throw new Error('ARTIFACT_HASH_MISMATCH');
}

export function readArtifactPath(value: unknown, path: string): unknown {
  const tokens = [...path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((match) =>
    match[2] === undefined ? match[1] : Number(match[2]),
  );
  let current: unknown = value;
  for (const token of tokens) {
    if (typeof token === 'number') {
      if (!Array.isArray(current) || token >= current.length)
        throw new Error('INVALID_EVIDENCE_PATH');
      current = current[token];
    } else {
      if (!token || current === null || typeof current !== 'object' || !(token in current))
        throw new Error('INVALID_EVIDENCE_PATH');
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current;
}

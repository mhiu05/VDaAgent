import { RepositoryError } from '@vda/db';

export async function body(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new RepositoryError('JSON_REQUIRED', 415);
  if (Number(request.headers.get('content-length') ?? 0) > 2_100_000)
    throw new RepositoryError('BODY_TOO_LARGE', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RepositoryError('JSON_REQUIRED', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 2_100_000) {
      await reader.cancel();
      throw new RepositoryError('BODY_TOO_LARGE', 413);
    }
    chunks.push(part.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RepositoryError('INVALID_JSON', 400);
  }
}

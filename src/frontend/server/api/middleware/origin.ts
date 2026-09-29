import { RepositoryError } from '@vda/db';

export function checkOrigin(request: Request, url: URL) {
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new RepositoryError('ORIGIN_DENIED', 403);
      }
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.host !== (request.headers.get('host') ?? url.host)
      )
        throw new RepositoryError('ORIGIN_DENIED', 403);
    }
  }
}

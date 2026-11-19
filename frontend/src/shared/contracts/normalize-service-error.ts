import type { ServiceError } from './service-result';

/** Adapter errors expose stable application codes, never raw server messages. Aborts remain control flow. */
export function normalizeServiceError(error: unknown): ServiceError {
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
  const candidate = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown } : {};
  const statuses: Record<number, string> = { 401: 'expired', 403: 'forbidden', 404: 'notFound', 409: 'conflict', 422: 'validation', 408: 'timeout', 501: 'unsupported' };
  const codes = ['expired', 'forbidden', 'notFound', 'conflict', 'validation', 'timeout', 'unsupported', 'unavailable'];
  const code = typeof candidate.code === 'string' && codes.includes(candidate.code) ? candidate.code
    : typeof candidate.status === 'number' ? statuses[candidate.status] ?? 'unavailable' : 'unavailable';
  const messageKeys: Record<string, string> = { forbidden: 'unauthorized', validation: 'invalid', conflict: 'saveError', timeout: 'unavailable' };
  return { code, messageKey: `app:${messageKeys[code] ?? code}`, retryable: ['unavailable', 'timeout', 'conflict'].includes(code) };
}

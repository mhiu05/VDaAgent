/** Allowlisted metadata only. Never copy messages, detail, queries or parameters. */
export function errorDiagnostics(cause: unknown): Record<string, string | string[] | number[]> {
  const result: Record<string, string | string[] | number[]> = {};
  const seen = new Set<unknown>();
  for (let depth = 0; cause && typeof cause === 'object' && depth < 12 && !seen.has(cause); depth++) {
    seen.add(cause);
    const error = cause as Record<string, unknown>;
    if (cause instanceof AggregateError && ['ALL_LLM_PROVIDERS_FAILED', 'LLM_AUTHENTICATION_FAILED'].includes(cause.message)) {
      const safeCodes = new Set([
        'GEMINI_REQUEST_FAILED', 'GEMINI_RESPONSE_INVALID', 'PROVIDER_UNGROUNDED_OUTPUT',
        'NARRATIVE_CONTEXT_LIMIT', 'PROVIDER_RESPONSE_INVALID', 'PROVIDER_TIMEOUT', 'PROVIDER_FAILED',
      ]);
      const failures = cause.errors.slice(0, 4).filter((error: unknown): error is Error => error instanceof Error &&
        (safeCodes.has(error.message) || /^PROVIDER_HTTP_[45][0-9]{2}$/.test(error.message)));
      const codes = failures.map((error: Error) => error.message);
      if (codes.length) result.provider_failure_codes = codes;
      const safeReasons = new Set(['empty_output', 'invalid_json', 'schema_mismatch', 'incomplete_output',
        'refusal', 'ungrounded_claims', 'timeout', 'http_error', 'request_failed', 'context_limit', 'unknown',
        'invalid_credentials', 'unsupported_credentials']);
      const metadata = failures as Array<Error & { failure_reason?: unknown; duration_ms?: unknown }>;
      if (metadata.some(error => typeof error.failure_reason === 'string' && safeReasons.has(error.failure_reason)))
        result.provider_failure_reasons = metadata.map(error => typeof error.failure_reason === 'string' && safeReasons.has(error.failure_reason) ? error.failure_reason : 'unknown');
      if (metadata.length && metadata.every(error => typeof error.duration_ms === 'number' && Number.isSafeInteger(error.duration_ms) && error.duration_ms >= 0))
        result.provider_failure_durations_ms = metadata.map(error => error.duration_ms as number);
    }
    if (!result.cause_type) {
      const name = cause instanceof Error ? cause.name : 'NonError';
      result.cause_type = ['Error', 'PostgresError', 'RepositoryError', 'TypeError', 'RangeError', 'ZodError', 'NonError'].includes(name) ? name : 'Error';
    }
    if (typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
      result.database_code = error.code;
      // postgres.js and PGlite use different property names.
      const constraint = error.constraint_name ?? error.constraint;
      if (typeof constraint === 'string' && /^[A-Za-z0-9_]{1,120}$/.test(constraint))
        result.database_constraint = constraint;
      break;
    }
    cause = error.cause;
  }
  return result;
}

import { z } from 'zod';
import { ProblemSchema } from '@vda/contracts';
import { RepositoryError } from '@vda/db';
import { RuntimeContextError } from '@vda/agents';
import { json } from './middleware/response';

export function logInternalError(error: unknown, method: string, route: string) {
  if (error instanceof RepositoryError && error.status < 500) return;
  if (error instanceof RuntimeContextError || error instanceof z.ZodError) return;
  const cause = error as { name?: unknown; code?: unknown; message?: unknown; table?: unknown; column?: unknown; constraint?: unknown } | null;
  const diagnostic: Record<string, string> = { method, route };
  if (typeof cause?.name === 'string') diagnostic.name = cause.name;
  if (typeof cause?.code === 'string' && /^[A-Z0-9_]{2,64}$/.test(cause.code)) diagnostic.code = cause.code;
  for (const field of ['table', 'column', 'constraint'] as const) {
    const value = cause?.[field];
    if (typeof value === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(value)) diagnostic[field] = value;
  }
  if (diagnostic.code === '42703' && typeof cause?.message === 'string') {
    const missingColumn = /^column "([a-zA-Z_][a-zA-Z0-9_]*)" does not exist$/.exec(cause.message);
    if (missingColumn) diagnostic.column = missingColumn[1];
  }
  console.error(`API request failed ${JSON.stringify(diagnostic)}`);
}

export function problemResponse(error: unknown) {
  if (
    error instanceof Error &&
    /^(CSV_|HIERARCHY_CONFLICT|DUPLICATE_SNAPSHOT|SCHEDULE_TIME_ABSENT)/.test(error.message)
  ) {
    const code = error.message.split(':')[0];
    return json(
      ProblemSchema,
      { type: `urn:vda:problem:${code.toLowerCase()}`, title: code, status: 422, detail: code },
      422,
    );
  }
  const status =
    error instanceof RepositoryError
      ? error.status
      : error instanceof RuntimeContextError
        ? 403
        : error instanceof z.ZodError
          ? 400
          : 500;
  const code =
    error instanceof RepositoryError
      ? error.code
      : error instanceof RuntimeContextError
        ? error.code
        : error instanceof z.ZodError
          ? 'VALIDATION_FAILED'
          : 'INTERNAL_ERROR';
  const detail =
    error instanceof z.ZodError
      ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      : status === 500
        ? 'Không thể hoàn tất yêu cầu. Kiểm tra cấu hình và thử lại.'
        : code;
  return json(
    ProblemSchema,
    { type: `urn:vda:problem:${code.toLowerCase()}`, title: code, status, detail },
    status,
  );
}

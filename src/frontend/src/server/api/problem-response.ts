import { z } from 'zod';
import { ProblemSchema } from '@vda/contracts';
import { RepositoryError } from '@vda/db';
import { RuntimeContextError } from '@vda/agents';
import { json } from './middleware/response';

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

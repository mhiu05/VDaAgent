import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public runId?: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    cache: 'no-store',
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const problem = z
      .object({
        detail: z.string().optional(),
        title: z.string().optional(),
        run_id: z.string().optional(),
      })
      .passthrough()
      .safeParse(body);
    throw new ApiError(
      problem.success
        ? (problem.data.detail ?? problem.data.title ?? 'Yêu cầu thất bại.')
        : 'Yêu cầu thất bại.',
      response.status,
      problem.success ? problem.data.run_id : undefined,
    );
  }
  return schema.parse(body);
}

export function scoped(path: string, orgId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}org_id=${encodeURIComponent(orgId)}`;
}

export function post(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Không thể hoàn thành yêu cầu. Vui lòng thử lại.';
}

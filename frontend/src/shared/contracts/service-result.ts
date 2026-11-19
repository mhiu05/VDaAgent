export type ServiceError = {
  code: string;
  messageKey: string;
  retryable: boolean;
  fieldErrors?: Record<string, string>;
};
export type ServiceResult<T> =
  { data: T; error?: never } | { error: ServiceError; data?: never };
export const failure = (
  code: string,
  retryable = true,
): { error: ServiceError } => ({
  error: { code, messageKey: `app:${code}`, retryable },
});

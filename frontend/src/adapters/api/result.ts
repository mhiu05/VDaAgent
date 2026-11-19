import type { ServiceResult } from "../../shared/contracts/service-result";
import { failure } from "../../shared/contracts/service-result";
import { normalizeServiceError } from "../../shared/contracts/normalize-service-error";
import { RepositoryError } from "../../features/reports/model/types";

/** Run an adapter operation as a `ServiceResult`; aborts stay control flow (doc 14c). */
export async function call<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<ServiceResult<T>> {
  signal?.throwIfAborted();
  try {
    return { data: await operation() };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof RepositoryError) {
      return failure(error.code, !["forbidden", "notFound", "validation"].includes(error.code));
    }
    return { error: normalizeServiceError(error) };
  }
}

export const forbidden = () => failure("forbidden", false);

export class RepositoryError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

export function fail(code: string, status = 400): never {
  throw new RepositoryError(code, status);
}

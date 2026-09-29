export function transient(error: unknown): boolean {
  const code = typeof error === 'object' && error ? (error as { code?: string }).code : undefined;
  const message = error instanceof Error ? error.message : '';
  return (
    ['08000', '08003', '08006', '25006', '40001', '40P01', '53300', '57P01', '57P02'].includes(
      code ?? '',
    ) || /ECONNRESET|EPIPE|timeout|connection/i.test(message)
  );
}

export async function retry<T>(
  operation: () => Promise<T>,
  recover?: () => Promise<void>,
): Promise<T> {
  let latest: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      latest = error;
      if (!transient(error) || attempt === 2) throw error;
      if (recover) {
        try {
          await recover();
        } catch (recoveryError) {
          latest = recoveryError;
          if (!transient(recoveryError) || attempt === 2) throw recoveryError;
        }
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * 2 ** attempt));
    }
  }
  throw latest;
}

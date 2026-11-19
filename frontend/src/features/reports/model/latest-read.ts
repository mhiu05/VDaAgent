/** Small feature controller primitive; no transport, cache, router or React dependency. */
export function createLatestRead<T>() {
  let revision = 0;
  let controller: AbortController | undefined;
  return {
    async run(read: (signal: AbortSignal) => Promise<T>): Promise<{ current: boolean; value?: T }> {
      const request = ++revision;
      controller?.abort();
      const current = new AbortController(); controller = current;
      try {
        const value = await read(current.signal);
        return request === revision ? { current: true, value } : { current: false };
      } catch (error) {
        if (request !== revision || current.signal.aborted) return { current: false };
        throw error;
      }
    },
    dispose() { ++revision; controller?.abort(); },
  };
}

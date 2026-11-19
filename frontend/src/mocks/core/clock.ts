export interface Clock {
  now(): Date;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
export const clock: Clock = {
  now: () => new Date(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted)
        return reject(new DOMException("Aborted", "AbortError"));
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", abort, { once: true });
    }),
};
export const fixtureEpoch = "2026-10-16T08:00:00.000Z";

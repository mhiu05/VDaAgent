export interface StorageAdapter {
  get<T>(
    scope: string,
    key: string,
    validate: (v: unknown) => v is T,
  ): T | null;
  set(scope: string, key: string, value: unknown): boolean;
  remove(scope: string, key: string): void;
  readonly degraded: boolean;
}
export function createStorage(
  kind: "localStorage" | "sessionStorage",
  unavailable = false,
): StorageAdapter {
  const memory = new Map<string, string>();
  let degraded = unavailable;
  const keyFor = (scope: string, key: string) => `vdaagent:v1:${scope}:${key}`;
  return {
    get degraded() {
      return degraded;
    },
    get(scope, key, validate) {
      const id = keyFor(scope, key);
      let raw = memory.get(id);
      try {
        if (!unavailable) raw = window[kind].getItem(id) ?? raw;
      } catch {
        degraded = true;
      }
      if (!raw) return null;
      try {
        const value: unknown = JSON.parse(raw);
        if (validate(value)) return value;
      } catch {
        /* Invalid persisted data is never trusted. */
      }
      degraded = true;
      this.remove(scope, key);
      return null;
    },
    set(scope, key, value) {
      const id = keyFor(scope, key);
      const raw = JSON.stringify(value);
      memory.set(id, raw);
      try {
        if (unavailable) throw new Error("unavailable");
        window[kind].setItem(id, raw);
        return true;
      } catch {
        degraded = true;
        return false;
      }
    },
    remove(scope, key) {
      const id = keyFor(scope, key);
      memory.delete(id);
      try {
        window[kind].removeItem(id);
      } catch {
        degraded = true;
      }
    },
  };
}

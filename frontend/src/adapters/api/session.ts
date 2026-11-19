import type { Preferences } from "../../shared/contracts/preferences";
import type { Principal, SessionDomain } from "../../shared/contracts/auth";

/** What the API adapters share about the logged-in user (filled at login and restore). */
export interface SessionStore {
  principal: Principal | null;
  domain: SessionDomain | null;
  preferences: Preferences | null;
  clear(): void;
  expire(): void;
  onExpired(listener: () => void): () => void;
}

export function createSessionStore(): SessionStore {
  const listeners = new Set<() => void>();
  return {
    principal: null, domain: null, preferences: null,
    clear() { this.principal = null; this.domain = null; this.preferences = null; },
    expire() {
      if (!this.principal) return;
      this.clear();
      listeners.forEach((listener) => listener());
    },
    onExpired(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

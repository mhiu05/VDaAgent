export type GuestRole = "analyst";

export type GuestSession = {
  id: string;
  role: GuestRole;
  accessToken: string;
};

const STORAGE_KEY = "p170-guest-session-v1";

export function guestEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_ALLOW_GUEST === "true";
}

function isRole(value: unknown): value is GuestRole {
  return value === "analyst";
}

function parse(raw: string | null): GuestSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { id?: unknown; role?: unknown };
    if (typeof value.id !== "string" || !isRole(value.role)) return null;
    return { id: value.id, role: value.role, accessToken: `guest.${value.id}.${value.role}` };
  } catch {
    return null;
  }
}

export function getGuestSession(): GuestSession | null {
  if (typeof window === "undefined") return null;
  return parse(window.sessionStorage.getItem(STORAGE_KEY));
}

export function startGuestSession(role: GuestRole = "analyst"): GuestSession {
  if (typeof window === "undefined") return { id: "server", role, accessToken: `guest.server.${role}` };
  const id = crypto.randomUUID();
  const session = { id, role, accessToken: `guest.${id}.${role}` };
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id, role }));
  return session;
}

export function clearGuestSession(): void {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(STORAGE_KEY);
}

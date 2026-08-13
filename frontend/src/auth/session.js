const SESSION_KEY = "profiling-agent.authSession";

export const demoAccounts = [
  {
    id: "da_analyst",
    username: "da",
    password: "da123",
    role: "da",
    displayName: "Data Analyst",
  },
  {
    id: "business_user",
    username: "user",
    password: "user123",
    role: "user",
    displayName: "Business User",
  },
  {
    id: "admin",
    username: "admin",
    password: "admin123",
    role: "admin",
    displayName: "Admin",
  },
];

export function getSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function login(username, password) {
  const account = demoAccounts.find((item) => (
    item.username === String(username || "").trim()
    && item.password === String(password || "")
  ));
  if (!account) {
    return { ok: false, error: "Invalid username or password." };
  }

  const { password: _password, ...safeAccount } = account;
  const session = {
    ...safeAccount,
    signedInAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  return { ok: true, session };
}

export function logout() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(SESSION_KEY);
  }
  return { ok: true };
}

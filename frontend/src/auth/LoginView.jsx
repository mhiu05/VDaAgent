import React, { useState } from "react";
import { Database, LockKeyhole, ShieldCheck } from "lucide-react";
import { demoAccounts, login } from "./session.js";

export function LoginView({ onLogin }) {
  const [username, setUsername] = useState("da");
  const [password, setPassword] = useState("da123");
  const [error, setError] = useState("");

  function submit(event) {
    event.preventDefault();
    const result = login(username, password);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    onLogin(result.session);
  }

  function useDemo(account) {
    setUsername(account.username);
    setPassword(account.password);
    setError("");
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <span><Database size={24} /></span>
          <div>
            <strong>Profiling Agent Platform</strong>
            <small>Data quality workspace</small>
          </div>
        </div>
        <div className="login-copy">
          <p className="fabric-kicker">Secure access</p>
          <h1>Sign in to continue</h1>
          <p>Use a role-based demo account. The Data Analyst workspace is available now; User and Admin workspaces are coming later.</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
          </label>
          {error ? <div className="inline-status status-error">{error}</div> : null}
          <button className="primary-button" type="submit">
            <LockKeyhole size={16} />
            Sign in
          </button>
        </form>

        <div className="demo-account-panel">
          <div>
            <ShieldCheck size={16} />
            <strong>Demo accounts</strong>
          </div>
          {demoAccounts.map((account) => (
            <button key={account.id} type="button" onClick={() => useDemo(account)}>
              <span>
                <b>{account.username}</b>
                <small>{account.role}</small>
              </span>
              <code>{account.password}</code>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

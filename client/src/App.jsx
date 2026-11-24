import { useEffect, useState } from "react";
import {
  errorMessage,
  getCurrentUser,
  login,
  logout,
  roleLabel,
  setSessionExpiredHandler,
} from "./services/api.js";
import AccountsPage from "./AccountsPage.jsx";
import "./App.css";

// Only "admin" may manage accounts (approved D-02); the backend enforces this.
// The check on user.role below only decides what to show.

// ---- Login page ------------------------------------------------------------

function LoginPage({ notice, onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      setPassword(""); // do not keep the password around
      onLoggedIn(user);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <h1>Bus Management System</h1>
        <p className="muted">Sign in to continue.</p>

        {notice && <p className="message info" role="status">{notice}</p>}
        {error && <p className="message error" role="alert">{error}</p>}

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={submitting}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={submitting}
        />

        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

// ---- Authenticated shell ---------------------------------------------------

function Shell({ user, onLogout }) {
  const [page, setPage] = useState("home");
  const [loggingOut, setLoggingOut] = useState(false);
  const isAdmin = user.role === "admin";

  async function handleLogout() {
    setLoggingOut(true);
    await onLogout();
  }

  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">Bus Management System</strong>
        <nav aria-label="Main">
          <button
            type="button"
            className={page === "home" ? "nav active" : "nav"}
            onClick={() => setPage("home")}
          >
            Home
          </button>
          {isAdmin && (
            <button
              type="button"
              className={page === "accounts" ? "nav active" : "nav"}
              onClick={() => setPage("accounts")}
            >
              Accounts
            </button>
          )}
        </nav>
        <div className="user-box">
          <span className="user-email">{user.email}</span>
          <span className="badge">{roleLabel(user.role)}</span>
          <button type="button" onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>

      <main className="content">
        {page === "accounts" && isAdmin ? (
          <AccountsPage currentUser={user} />
        ) : (
          <section className="card">
            <h2>Welcome</h2>
            <p>
              You are signed in as <strong>{user.email}</strong> (
              {roleLabel(user.role)}).
            </p>
            {!user.role && (
              <p className="message info">
                No role has been assigned to your account yet. Ask an Admin to
                assign one.
              </p>
            )}
            {isAdmin && (
              <p className="muted">Use “Accounts” to manage internal accounts.</p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

// ---- App: session restore + routing between login and shell -----------------

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true); // true while /auth/me runs
  const [notice, setNotice] = useState("");
  const [startupError, setStartupError] = useState("");

  // If any API call returns 401, go back to the login screen.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setNotice("Your session has expired. Please sign in again.");
    });
  }, []);

  // Restore the session after a page refresh (the cookie is kept by the browser).
  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((current) => {
        if (!cancelled) setUser(current);
      })
      .catch((err) => {
        if (!cancelled) setStartupError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Even if the request failed (e.g. session already gone), leave the app.
    }
    setNotice("");
    setUser(null);
  }

  if (checking) {
    return (
      <main className="login-page">
        <p className="muted" role="status">Loading…</p>
      </main>
    );
  }

  if (startupError) {
    return (
      <main className="login-page">
        <div className="card login-card">
          <h1>Bus Management System</h1>
          <p className="message error" role="alert">{startupError}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <LoginPage
        notice={notice}
        onLoggedIn={(loggedIn) => {
          setNotice("");
          setUser(loggedIn);
        }}
      />
    );
  }

  return <Shell user={user} onLogout={handleLogout} />;
}

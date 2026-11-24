import { useEffect, useState } from "react";
import {
  errorMessage,
  getCurrentUser,
  logout,
  setSessionExpiredHandler,
} from "./services/api.js";
import AccountsPage from "./AccountsPage.jsx";
import AuditPage from "./AuditPage.jsx";
import AppShell from "./layouts/AppShell.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import HomePage from "./pages/HomePage.jsx";
import "./App.css";
import "./theme.css";

// Only "admin" may manage accounts (approved D-02); the backend enforces this.
// The check on user.role below only decides what to show.

const HOME_NAV = { key: "home", label: "Home", icon: "home" };
const ADMIN_NAV = [
  { key: "accounts", label: "Accounts", icon: "users" },
  { key: "audit", label: "Audit log", icon: "clock" },
];

function Authenticated({ user, onLogout }) {
  const [page, setPage] = useState("home");
  const [loggingOut, setLoggingOut] = useState(false);
  const isAdmin = user.role === "admin";

  const navItems = isAdmin ? [HOME_NAV, ...ADMIN_NAV] : [HOME_NAV];
  // A non-admin can never land on an admin page, even if state were changed.
  const current = navItems.some((item) => item.key === page) ? page : "home";

  async function handleLogout() {
    setLoggingOut(true);
    await onLogout();
  }

  return (
    <AppShell
      user={user}
      navItems={navItems}
      page={current}
      onNavigate={setPage}
      onLogout={handleLogout}
      loggingOut={loggingOut}
    >
      {current === "accounts" && isAdmin ? (
        <AccountsPage currentUser={user} />
      ) : current === "audit" && isAdmin ? (
        <AuditPage />
      ) : (
        <HomePage user={user} onNavigate={setPage} />
      )}
    </AppShell>
  );
}

// ---- App: session restore + routing between login and the app ----------------

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
      <main className="bm-center">
        <p className="bm-muted" role="status">
          Loading…
        </p>
      </main>
    );
  }

  if (startupError) {
    return (
      <main className="bm-center">
        <div className="bm-center-card">
          <h1 className="bm-auth-title">Bus Management System</h1>
          <p className="bm-alert bm-alert-error" role="alert">
            {startupError}
          </p>
          <button
            type="button"
            className="bm-btn bm-btn-primary"
            onClick={() => window.location.reload()}
          >
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

  return <Authenticated user={user} onLogout={handleLogout} />;
}


import { useEffect, useState } from "react";
import DriversPage from "./pages/DriverPage.jsx";
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
import LandingPage from "./pages/LandingPage.jsx";
import BusesPage from "./pages/BusesPage.jsx";
import RoutesPage from "./pages/RoutesPage.jsx";
import { navigate, usePath } from "./utils/navigation.js";
import { CAPABILITIES, can } from "./utils/permissions.js";
import "./App.css";
import "./theme.css";

// Only "admin" may manage accounts (approved D-02); the backend enforces this.
// The check on user.role below only decides what to show.

const HOME_NAV = { key: "home", label: "Home", icon: "home" };
const BUSES_NAV = { key: "buses", label: "Buses", icon: "bus" };
const ROUTES_NAV = { key: "routes", label: "Routes", icon: "route" };
const DRIVERS_NAV = { key: "drivers", label: "Drivers", icon: "users" };
const ADMIN_NAV = [
  { key: "accounts", label: "Accounts", icon: "users" },
  { key: "audit", label: "Audit log", icon: "clock" },
];

function Authenticated({ user, onLogout }) {
  const [page, setPage] = useState("home");
  const [loggingOut, setLoggingOut] = useState(false);
  const isAdmin = user.role === "admin";
  // UI hints only; the backend checks "view-buses" / "view-routes" on every request.
  const canViewBuses = can(user, CAPABILITIES.VIEW_BUSES);
  const canViewRoutes = can(user, CAPABILITIES.VIEW_ROUTES);
    const canViewDrivers = can(user, CAPABILITIES.VIEW_DRIVERS);

   const navItems = [
    HOME_NAV,
    ...(canViewBuses ? [BUSES_NAV] : []),
    ...(canViewRoutes ? [ROUTES_NAV] : []),
    ...(canViewDrivers ? [DRIVERS_NAV] : []),
    ...(isAdmin ? ADMIN_NAV : []),
  ];
  // A user can never land on a page they have no nav item for, even if state were changed.
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
      {current === "buses" ? (
        <BusesPage user={user} />
      ) : current === "routes" ? (
        <RoutesPage user={user} />
      ) : current === "drivers" ? (
        <DriversPage user={user} /> 
      ): current === "accounts" && isAdmin ? (
        <AccountsPage currentUser={user} />
      ) : current === "audit" && isAdmin ? (
        <AuditPage />
      ) : (
        <HomePage user={user} onNavigate={setPage} />
      )}
    </AppShell>
  );
}

// ---- App: session restore + routing between landing, login and the app ------
//
// Public URLs (see utils/navigation.js):
//   "/"       landing page for visitors, dashboard for signed-in users
//   "/login"  login page (visitors only)

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true); // true while /auth/me runs
  const [notice, setNotice] = useState("");
  const [startupError, setStartupError] = useState("");
  const path = usePath();

  // If any API call returns 401, go back to the login screen.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setNotice("Your session has expired. Please sign in again.");
      navigate("/login", { replace: true });
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

  // Keep the URL consistent with who is signed in:
  //  - signed in: always "/" (the dashboard)
  //  - signed out: "/login" or "/" only; any other path becomes "/"
  useEffect(() => {
    if (checking) return;
    const allowed = !user && path === "/login" ? "/login" : "/";
    if (path !== allowed) navigate(allowed, { replace: true });
  }, [checking, user, path]);

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
    if (path === "/login") {
      return (
        <LoginPage
          notice={notice}
          onBack={() => navigate("/")}
          onLoggedIn={(loggedIn) => {
            setNotice("");
            setUser(loggedIn);
          }}
        />
      );
    }
    return <LandingPage onAccessPortal={() => navigate("/login")} />;
  }

  return <Authenticated user={user} onLogout={handleLogout} />;
}
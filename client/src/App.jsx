import { useEffect, useState } from "react";
import RecruitmentPage from "./features/recruitment/RecruitmentPage.jsx";
import RegisterPage from "./features/recruitment/RegisterPage.jsx";
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
import SchedulesPage from "./pages/SchedulesPage.jsx";
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
const SCHEDULES_NAV = {
  key: "schedules",
  label: "Schedules",
  icon: "calendar",
};
const TRIPS_NAV = { key: "schedules", label: "My trips", icon: "calendar" };
const ADMIN_NAV = [
  { key: "accounts", label: "Accounts", icon: "users" },
  { key: "audit", label: "Audit log", icon: "clock" },
];

function Authenticated({ user, onLogout }) {
  const [page, setPage] = useState(
    can(user, CAPABILITIES.APPLY_RECRUITMENT) ? "recruitment" : "home",
  );
  const [loggingOut, setLoggingOut] = useState(false);
  const isAdmin = user.role === "admin";
  // UI hints only; the backend checks each capability on every request.
  const canViewBuses = can(user, CAPABILITIES.VIEW_BUSES);
  const canViewRoutes = can(user, CAPABILITIES.VIEW_ROUTES);
  const canViewDrivers = can(user, CAPABILITIES.VIEW_DRIVERS);
  const canViewSchedules = can(user, CAPABILITIES.VIEW_SCHEDULES);
  const canViewOwnTrips = can(user, CAPABILITIES.VIEW_OWN_TRIPS);

  const navItems = [
    ...(!can(user, CAPABILITIES.APPLY_RECRUITMENT) ? [HOME_NAV] : []),
    ...(can(user, CAPABILITIES.APPLY_RECRUITMENT) ||
    can(user, CAPABILITIES.VIEW_RECRUITMENT)
      ? [{ key: "recruitment", label: "Recruitment", icon: "users" }]
      : []),
    ...(canViewBuses ? [BUSES_NAV] : []),
    ...(canViewRoutes ? [ROUTES_NAV] : []),
    ...(canViewDrivers ? [DRIVERS_NAV] : []),
    ...(canViewSchedules
      ? [SCHEDULES_NAV]
      : canViewOwnTrips
        ? [TRIPS_NAV]
        : []),
    ...(isAdmin ? ADMIN_NAV : []),
  ];
  // A user can never land on a page they have no nav item for, even if state were changed.
  const current = navItems.some((item) => item.key === page)
    ? page
    : (navItems[0]?.key ?? "home");

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
      {current === "recruitment" ? (
        <RecruitmentPage user={user} />
      ) : current === "buses" ? (
        <BusesPage user={user} />
      ) : current === "routes" ? (
        <RoutesPage user={user} />
      ) : current === "drivers" ? (
        <DriversPage user={user} />
      ) : current === "schedules" ? (
        <SchedulesPage user={user} />
      ) : current === "accounts" && isAdmin ? (
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
//   "/register" applicant registration (visitors only)

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
  //  - signed out: "/login", "/register", or "/"; other paths become "/"
  useEffect(() => {
    if (checking) return;
    const allowed =
      !user && ["/login", "/register"].includes(path) ? path : "/";
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
    if (path === "/register")
      return (
        <RegisterPage
          onBack={() => navigate("/login")}
          onLoggedIn={(loggedIn) => {
            setNotice("");
            setUser(loggedIn);
          }}
        />
      );
    if (path === "/login") {
      return (
        <LoginPage
          notice={notice}
          onRegister={() => navigate("/register")}
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

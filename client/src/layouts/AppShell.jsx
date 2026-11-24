import { useEffect, useState } from "react";
import Icon from "../components/Icon.jsx";
import { roleLabel } from "../services/api.js";

// Sidebar + top bar. Which nav items exist is decided by the caller (App.jsx),
// which uses the same admin check as before. This component only renders them.
export default function AppShell({
  user,
  navItems,
  page,
  onNavigate,
  onLogout,
  loggingOut,
  children,
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    function handleKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const current = navItems.find((item) => item.key === page);
  const initial = (user.email || "?").charAt(0).toUpperCase();

  function go(key) {
    setOpen(false);
    onNavigate(key);
  }

  return (
    <div className="bm-app">
      <a className="bm-skip" href="#bm-main">
        Skip to content
      </a>

      {open && (
        <div
          className="bm-scrim"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="bm-sidebar"
        className={`bm-sidebar${open ? " is-open" : ""}`}
        aria-label="Primary"
      >
        <div className="bm-sidebar-top">
          <div className="bm-logo">
            <span className="bm-logo-mark">
              <Icon name="bus" size={20} />
            </span>
            <span className="bm-logo-name">Bus Management</span>
          </div>
          <button
            type="button"
            className="bm-sidebar-close"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <Icon name="x" />
          </button>
        </div>

        <nav className="bm-nav" aria-label="Main">
          <span className="bm-nav-heading">Workspace</span>
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`bm-nav-item${page === item.key ? " is-active" : ""}`}
              aria-current={page === item.key ? "page" : undefined}
              onClick={() => go(item.key)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="bm-sidebar-foot">
          <div className="bm-user">
            <span className="bm-user-avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="bm-user-text">
              <span className="bm-user-email" title={user.email}>
                {user.email}
              </span>
              <span className="bm-user-role">{roleLabel(user.role)}</span>
            </span>
          </div>
          <button
            type="button"
            className="bm-signout"
            onClick={onLogout}
            disabled={loggingOut}
          >
            <Icon name="logout" />
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      <div className="bm-main">
        <header className="bm-topbar">
          <button
            type="button"
            className="bm-menu-btn"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            aria-expanded={open}
            aria-controls="bm-sidebar"
          >
            <Icon name="menu" />
          </button>
          <p className="bm-topbar-title">{current?.label ?? "Home"}</p>
          <span className="bm-role-chip">{roleLabel(user.role)}</span>
        </header>

        <main id="bm-main" className="bm-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
